/**
 * @module main/index
 *
 * Electron main-process entry point (2181 lines).
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 *
 * Dependencies: session-manager, config-store, mcp-manager, sandbox-adapter,
 *               skills-manager, scheduled-task-manager, nav-server, remote-manager
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, Tray } from 'electron';
import { join, resolve, dirname, isAbsolute, basename } from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { initDatabase, closeDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { PluginCatalogService } from './skills/plugin-catalog-service';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import { MemoryService } from './memory/memory-service';
import { MemoryExtension } from './memory/memory-extension';
import { AgentRuntimeExtensionManager } from './extensions/agent-runtime-extension-manager';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type AppTheme,
  type CreateConfigSetPayload,
} from './config/config-store';
import { runConfigApiTest } from './config/config-test-routing';
import { listOllamaModels } from './config/ollama-api';
import {
  setPermissionRules,
  setPersistentAlwaysAllow,
  setAlwaysAllowPersister,
} from './config/permission-rules-store';
import {
  getAlwaysAllowedTools,
  addAlwaysAllowedTool,
} from './config/persistent-permissions-store';
import {
  getBranding,
  setAppName,
  setLogoDataUrl,
  clearLogo,
} from './config/branding-store';
import { verifyLicenseKey, getMachineId } from './license/license-verifier';
import {
  getStoredLicenseKey,
  setStoredLicenseKey,
  clearStoredLicenseKey,
} from './license/license-store';
import {
  listReports,
  getReport,
  saveStaticReport,
  saveDynamicReport,
  saveAiReport,
  duplicateReport,
  renameReport,
  deleteReport,
} from './bi/bi-report-store';
import { renderReport } from './bi/bi-report-runner';
import { analyzeSessionForReport } from './bi/bi-report-analyzer';
import { buildReportTemplate } from './bi/bi-report-builder';
import { getTokenUsageLog } from './usage/token-usage';
import type {
  SaveStaticReportInput,
  SaveDynamicReportInput,
  SaveAiReportInput,
} from '../shared/bi-report';
import { mcpConfigStore } from './mcp/mcp-config-store';
import { getSandboxAdapter, shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { WSLBridge } from './sandbox/wsl-bridge';
import { LimaBridge } from './sandbox/lima-bridge';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { MCPServerConfig } from './mcp/mcp-manager';
import type {
  ClientEvent,
  ServerEvent,
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
  PermissionRule,
} from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import type { GatewayConfig, FeishuChannelConfig, ChannelType } from './remote/types';
import { startNavServer, stopNavServer } from './nav-server';
import {
  ScheduledTaskManager,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdateInput,
} from './schedule/scheduled-task-manager';
import { createScheduledTaskStore } from './schedule/scheduled-task-store';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../shared/schedule/task-title';
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  decodePathSafely,
} from '../shared/local-file-path';
import { eventRequiresSessionManager } from './client-event-utils';
import { getUnsupportedWorkspacePathReason } from './workspace-path-constraints';
import {
  log,
  logWarn,
  logError,
  getLogFilePath,
  getLogsDirectory,
  getAllLogFiles,
  closeLogFile,
  setDevLogsEnabled,
  isDevLogsEnabled,
} from './utils/logger';
import { listRecentWorkspaceFiles } from './utils/recent-workspace-files';
import { buildDiagnosticsSummary } from './utils/diagnostics-summary';

// Current working directory (persisted between sessions)
let currentWorkingDir: string | null = null;

// Load .env file from project root (for development)
const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  log('[dotenv] Loaded successfully');
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

// Restore persistent "always allow" tool grants from disk and wire the
// persister so future grants are saved (claude.ai-style permanent permissions).
setPersistentAlwaysAllow(getAlwaysAllowedTools());
setAlwaysAllowPersister(addAlwaysAllowedTool);

// Windows: set an explicit AppUserModelID so the taskbar uses the window icon
// (instead of the generic electron.exe icon) even when running unpackaged.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.aiierp.app');
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;
let pluginRuntimeService: PluginRuntimeService | null = null;
let memoryService: MemoryService | null = null;
let scheduledTaskManager: ScheduledTaskManager | null = null;

function sanitizeDiagnosticBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return value.replace(/[?#].*$/, '');
  }
}

async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!sessionManager) {
    return fallback;
  }
  try {
    return await sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn('[Schedule] Failed to generate title via session title flow, using fallback', error);
    return fallback;
  }
}

async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';

// Enable Chrome DevTools Protocol in dev mode so the renderer can be inspected
// via chrome://inspect or connected to by Puppeteer/Playwright at localhost:9223.
// Chrome MCP uses 9222, so keep Electron on a separate port in development.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
  app.commandLine.appendSwitch(
    'remote-allow-origins',
    `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
  );
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn('[App] Another instance is already running, quitting this instance');
  app.quit();
} else if (!isDev) {
  app.on('second-instance', () => {
    const existingWindow =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!existingWindow) {
      log('[App] No existing window found, creating new one');
      createWindow();
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = existingWindow;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    log('[App] Blocked second instance and focused existing window');
  });
}

// Tray instance (kept alive to prevent GC)
let tray: Tray | null = null;
const DARK_BG = '#171614';
const LIGHT_BG = '#f5f3ee';

function buildMacMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (tray) return;

  // Use .ico on Windows for proper multi-resolution tray support; fall back to .png if absent
  const iconName =
    process.platform === 'darwin'
      ? 'tray-iconTemplate.png'
      : process.platform === 'win32'
        ? 'tray-icon.ico'
        : 'tray-icon.png';
  // TODO: create resources/tray-icon.ico from tray-icon.png for full Windows tray fidelity
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, '../../resources', iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, 'tray-icon.png')
        : join(__dirname, '../../resources', 'tray-icon.png')
      : iconPath;

  // Gracefully skip tray if icon is missing (e.g. dev environment)
  if (!fs.existsSync(resolvedIconPath)) {
    log('[Tray] Icon not found at', resolvedIconPath, '— skipping tray setup');
    return;
  }

  tray = new Tray(resolvedIconPath);
  tray.setToolTip(getBranding().appName);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'navigate', payload: 'settings' });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
}

function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: DARK_BG,
          titleBar: DARK_BG,
          titleBarSymbol: '#f1ece4',
        }
      : {
          background: LIGHT_BG,
          titleBar: LIGHT_BG,
          titleBarSymbol: '#1a1a1a',
        };

  // Platform-specific window configuration
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      // Use a PNG for the runtime window/taskbar icon (Electron renders PNG
      // reliably at taskbar sizes; a hand-built .ico can fail to display).
      // electron-builder still uses icon.ico/.icns for the packaged .exe/app.
      const windowIconName = isMac ? 'icon.icns' : 'icon.png';
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Enable <webview> so the in-app HTML preview can render dashboards
      // (Chart.js from CDN + inline scripts) in an isolated context that does
      // NOT inherit the app's strict CSP — keeping the main app CSP locked down.
      webviewTag: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || '');
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    // Send current working directory to renderer
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize default working directory
 * This is always the app's default_working_dir in userData - it never changes
 * Each session can have its own cwd that differs from this default
 */
function initializeDefaultWorkingDir(): string {
  // Prefer a folder the user configured in Settings (persisted as defaultWorkdir),
  // so new chats default to it. Fall back to the app's default_working_dir.
  const configured = configStore.get('defaultWorkdir');
  if (typeof configured === 'string' && configured.trim() && fs.existsSync(configured)) {
    currentWorkingDir = configured;
    log('[App] Global default working directory (from settings):', currentWorkingDir);
    return currentWorkingDir;
  }

  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update UI display only (for WelcomeView - will be used when creating new session)
 *
 * Note: The global default (currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/default_working_dir
 */
async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  } else {
    // No session → this sets the GLOBAL default folder. Persist it so new chats
    // (and future restarts) default to this folder.
    currentWorkingDir = newDir;
    try {
      configStore.update({ defaultWorkdir: newDir });
    } catch (error) {
      logError('[App] Failed to persist default working directory:', error);
    }
    log('[App] Global default working directory set to:', newDir);
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  // Skip if already complete
  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

// Send events to the renderer process (with remote session interception)
function sendToRenderer(event: ServerEvent) {
  const payload =
    'payload' in event
      ? (event.payload as { sessionId?: string; [key: string]: unknown })
      : undefined;
  const sessionId = payload?.sessionId;

  // Check whether this is a remote session
  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // Handle remote session events

    // Intercept stream.message to relay it back to the remote channel
    if (event.type === 'stream.message') {
      const message = payload.message as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (message?.role === 'assistant' && message?.content) {
        // Extract the assistant's text content
        const textContent = message.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');

        if (textContent) {
          // Send to the remote channel (buffered)
          remoteManager.sendResponseToChannel(sessionId, textContent).catch((err: Error) => {
            logError('[Remote] Failed to send response to channel:', err);
          });
        }
      }
    }

    // Intercept trace.step as tool progress
    if (event.type === 'trace.step') {
      const step = payload.step as {
        type?: string;
        toolName?: string;
        status?: string;
        title?: string;
      };
      if (step?.type === 'tool_call' && step?.toolName) {
        remoteManager
          .sendToolProgress(
            sessionId,
            step.toolName,
            step.status === 'completed'
              ? 'completed'
              : step.status === 'error'
                ? 'error'
                : 'running'
          )
          .catch((err: Error) => {
            logError('[Remote] Failed to send tool progress:', err);
          });
      }
    }

    // trace.update is reserved; currently we mainly use trace.step

    // Intercept session.status for cleanup
    if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        // Session ended, clear the buffer
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    }

    // Intercept permission.request
    if (event.type === 'permission.request' && payload.toolUseId && payload.toolName) {
      log('[Remote] Intercepting permission for remote session:', sessionId);
      remoteManager
        .handlePermissionRequest(
          sessionId,
          payload.toolUseId as string,
          payload.toolName as string,
          (payload.input as Record<string, unknown> | undefined) ?? {}
        )
        .then((result) => {
          if (result !== null && sessionManager) {
            let permissionResult: 'allow' | 'deny' | 'allow_always';
            if (result.allow) {
              permissionResult = result.remember ? 'allow_always' : 'allow';
            } else {
              permissionResult = 'deny';
            }
            sessionManager.handlePermissionResponse(payload.toolUseId as string, permissionResult);
          }
        })
        .catch((err) => {
          logError('[Remote] Failed to handle permission request:', err);
        });
      return; // Do not send to the local UI
    }
  }

  // Send to the local UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}

// Initialize app
app
  .whenReady()
  .then(async () => {
    // Smoke test mode: verify the app can start, then exit cleanly
    if (process.argv.includes('--smoke-test')) {
      log('[SmokeTest] App launched successfully in smoke test mode');
      log('[SmokeTest] Platform:', process.platform, 'Arch:', process.arch);
      log('[SmokeTest] Electron:', process.versions.electron, 'Node:', process.versions.node);
      try {
        // Verify critical native modules load
        require('better-sqlite3');
        log('[SmokeTest] better-sqlite3: OK');
      } catch (e) {
        log('[SmokeTest] FAIL: better-sqlite3 failed to load:', e);
        process.exit(1);
      }
      log('[SmokeTest] PASSED');
      process.exit(0);
    }

    // Apply dev logs setting from config
    const enableDevLogs = configStore.get('enableDevLogs');
    setDevLogsEnabled(enableDevLogs);

    // Log environment variables for debugging
    log('=== Open Cowork Starting ===');
    log('Config file:', configStore.getPath());
    log('Is configured:', configStore.isConfigured());
    log('[Runtime] Using Open Cowork agent SDK for all providers');
    log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
    log('Environment Variables:');
    log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
    log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
    log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
    log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
    log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
    log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
    log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
    log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
    log('===========================');

    // Initialize default working directory
    initializeDefaultWorkingDir();
    log('Working directory:', currentWorkingDir);
    // Remote sessions use the global working directory by default
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

    // Initialize database
    const db = initDatabase();

    pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());
    memoryService = new MemoryService(db);
    const extensionManager = new AgentRuntimeExtensionManager([new MemoryExtension(memoryService)]);

    // Initialize session manager before creating an interactive window.
    // This avoids session.start racing the startup path and hitting a null manager.
    sessionManager = new SessionManager(db, sendToRenderer, pluginRuntimeService, extensionManager);
    skillsManager = new SkillsManager(db, {
      getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
      setConfiguredGlobalSkillsPath: (nextPath: string) => {
        configStore.update({ globalSkillsPath: nextPath });
      },
      watchStorage: true,
    });
    skillsManager.onStorageChanged((event) => {
      sendToRenderer({
        type: 'skills.storageChanged',
        payload: event,
      });
    });
    // pi-ai handles model routing natively — no proxy warmup needed

    // macOS: application menu, dock menu, tray icon
    buildMacMenu();
    setupTray();

    // Show window after core managers are ready so first-load actions can be handled.
    createWindow();

    // macOS: dock menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Session',
          click: () => mainWindow?.webContents.send('server-event', { type: 'new-session' }),
        },
        {
          label: 'Settings',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    // macOS: send initial system theme to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer({
          type: 'native-theme.changed',
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (getSavedThemePreference() === 'system' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
      }
    });

    // Auto-updater: check for updates in production
    if (!isDev) {
      import('electron-updater')
        .then(({ autoUpdater }) => {
          autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
            log('[AutoUpdater] Update check failed:', err);
          });
        })
        .catch((err: unknown) => {
          log('[AutoUpdater] Failed to load electron-updater:', err);
        });
    }

    startNavServer(() => mainWindow);

    const scheduledTaskStore = createScheduledTaskStore(db);
    scheduledTaskManager = new ScheduledTaskManager({
      store: scheduledTaskStore,
      executeTask: async (task) => {
        if (!sessionManager) {
          throw new Error('Session manager not initialized');
        }
        const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
        const needsRegeneratedTitle = !task.title?.trim() || task.title === fallbackTitle;
        const title = needsRegeneratedTitle
          ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
          : buildScheduledTaskTitle(task.title);
        if (title !== task.title) {
          scheduledTaskStore.update(task.id, { title });
        }
        const started = await sessionManager.startSession(title, task.prompt, task.cwd);
        // New sessions created by scheduled tasks must be actively synced to the frontend session list
        sendToRenderer({
          type: 'session.update',
          payload: { sessionId: started.id, updates: started },
        });
        return { sessionId: started.id };
      },
      onTaskError: (taskId, error) => {
        sendToRenderer({
          type: 'scheduled-task.error',
          payload: { taskId, error },
        });
      },
      now: () => Date.now(),
    });
    scheduledTaskManager.start();

    // Initialize the remote manager
    remoteManager.setRendererCallback(sendToRenderer);
    const agentExecutor: AgentExecutor = {
      startSession: async (title, prompt, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        return sessionManager.startSession(title, prompt, cwd);
      },
      continueSession: async (sessionId, prompt, content, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        if (cwd) {
          const result = await setWorkingDir(cwd, sessionId);
          if (!result.success) {
            throw new Error(result.error || 'Failed to update working directory');
          }
        }
        await sessionManager.continueSession(sessionId, prompt, content);
      },
      stopSession: async (sessionId) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        await sessionManager.stopSession(sessionId);
      },
      validateWorkingDirectory: async (cwd) => {
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          return unsupportedReason;
        }
        if (!fs.existsSync(cwd)) {
          return 'Directory does not exist';
        }
        return null;
      },
    };
    remoteManager.setAgentExecutor(agentExecutor);

    // Start remote control when it is enabled
    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError('[App] Failed to start remote control:', error);
      });
    }

    app.on('activate', () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError('[App] Startup failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox(
      `${getBranding().appName} failed to start`,
      `${message}\n\nVui lòng xem log để biết thêm chi tiết.`
    );
    app.quit();
  });

// Flag to prevent double cleanup
let isCleaningUp = false;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  stopNavServer();
  skillsManager?.stopStorageMonitoring();
  scheduledTaskManager?.stop();
  tray?.destroy();
  tray = null;

  // Stop remote control
  try {
    log('[App] Stopping remote control...');
    await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    // Cleanup Lima sessions
    const { LimaSync } = await import('./sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
    // On Windows/Linux, closing all windows means quit.
    // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
    // without the old process holding the single-instance lock.
    await cleanupSandboxResources();
    app.quit();
  }
  // On macOS production, keep app alive — cleanup happens in before-quit
});

// Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => app.quit());
}

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    // In dev mode, exit quickly — no need for async sandbox cleanup
    if (process.env.VITE_DEV_SERVER_URL) {
      stopNavServer();
      try {
        closeDatabase();
      } catch {
        /* best-effort */
      }
      closeLogFile();
      tray?.destroy();
      tray = null;
      return;
    }
    // Set the flag immediately before any await to prevent re-entrant cleanup
    isCleaningUp = true;
    event.preventDefault();
    try {
      await cleanupSandboxResources();
    } catch (error) {
      logError('[App] before-quit cleanup failed, forcing quit:', error);
    }
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  try {
    return app.getVersion();
  } catch (error) {
    logError('[IPC] Error getting version:', error);
    return 'unknown';
  }
});

ipcMain.handle('system.getTheme', () => {
  try {
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
  } catch (error) {
    logError('[IPC] Error getting theme:', error);
    return { shouldUseDarkColors: true };
  }
});

ipcMain.handle('shell.openExternal', async (_event, url: string) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
      return false;
    }
  } catch {
    logWarn('[shell.openExternal] Blocked invalid URL:', url);
    return false;
  }

  return shell.openExternal(url);
});

// Resolve a (possibly relative / file:// / /workspace/) path to an absolute
// path within the workspace. Shared by open-file and preview.
function resolveWorkspaceFilePath(filePath: string, cwd?: string): string | null {
  const trimInput = (filePath || '').trim();
  if (!trimInput) {
    return null;
  }
  let normalizedPath = decodePathSafely(trimInput);
  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      return null;
    }
    normalizedPath = localPath;
  }
  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }
  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }
  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  return normalizedPath;
}

// Open a file with the OS default app (Word/Excel/browser/PDF viewer, ...).
// Returns false on failure so the renderer can fall back to "show in folder".
ipcMain.handle('shell.openFile', async (_event, filePath: string, cwd?: string): Promise<boolean> => {
  try {
    const normalizedPath = resolveWorkspaceFilePath(filePath, cwd);
    if (!normalizedPath || !fs.existsSync(normalizedPath)) {
      logWarn('[shell.openFile] file not found:', normalizedPath);
      return false;
    }
    const result = await shell.openPath(normalizedPath); // '' on success, error string otherwise
    if (result) {
      logWarn('[shell.openFile] openPath warning:', result);
      return false;
    }
    return true;
  } catch (error) {
    logError('[shell.openFile] error:', error);
    return false;
  }
});

// Read a file for in-app preview. Classifies by extension and returns inline
// content (text for html/text, base64 data URL for image/pdf). Binary office
// files (.docx/.xlsx/...) are 'unsupported' → the renderer opens them externally.
const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;
const PREVIEW_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const PREVIEW_TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'yml', 'yaml',
  'js', 'mjs', 'ts', 'tsx', 'jsx', 'css', 'py', 'sql', 'sh',
]);

ipcMain.handle(
  'preview.readFile',
  async (_event, filePath: string, cwd?: string) => {
    try {
      const p = resolveWorkspaceFilePath(filePath, cwd);
      if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
        return { ok: false, kind: 'unsupported' as const, name: '', error: 'not_found' };
      }
      const name = basename(p);
      const ext = (name.split('.').pop() || '').toLowerCase();
      const size = fs.statSync(p).size;
      if (size > PREVIEW_MAX_BYTES) {
        return { ok: false, kind: 'unsupported' as const, name, error: 'too_large' };
      }
      if (ext === 'html' || ext === 'htm') {
        return { ok: true, kind: 'html' as const, name, text: fs.readFileSync(p, 'utf8') };
      }
      if (PREVIEW_IMAGE_EXTS.has(ext)) {
        const mime =
          ext === 'svg' ? 'image/svg+xml'
          : ext === 'jpg' ? 'image/jpeg'
          : ext === 'ico' ? 'image/x-icon'
          : `image/${ext}`;
        return {
          ok: true,
          kind: 'image' as const,
          name,
          mime,
          dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`,
        };
      }
      if (ext === 'pdf') {
        return {
          ok: true,
          kind: 'pdf' as const,
          name,
          mime: 'application/pdf',
          dataUrl: `data:application/pdf;base64,${fs.readFileSync(p).toString('base64')}`,
        };
      }
      if (PREVIEW_TEXT_EXTS.has(ext)) {
        return { ok: true, kind: 'text' as const, name, text: fs.readFileSync(p, 'utf8') };
      }
      return { ok: false, kind: 'unsupported' as const, name };
    } catch (error) {
      logError('[preview.readFile] error:', error);
      return { ok: false, kind: 'unsupported' as const, name: '', error: 'read_error' };
    }
  }
);

async function revealFileInFolder(filePath: string, cwd?: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

  const findFileByName = (fileName: string, roots: string[]): string | null => {
    if (!fileName) {
      return null;
    }

    const visited = new Set<string>();
    const queue = roots
      .map((root) => resolve(root))
      .filter((root) => !!root && fs.existsSync(root) && fs.statSync(root).isDirectory());

    let scannedDirs = 0;
    const MAX_DIRS = 2000;

    while (queue.length > 0 && scannedDirs < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) {
        continue;
      }
      visited.add(dir);
      scannedDirs += 1;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }

    return null;
  };

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
        }
      } else {
        if (process.platform === 'darwin') {
          try {
            execFileSync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const fileName = basename(normalizedPath);
    const defaultWorkingDir = getWorkingDir() || '';
    const discoveredPath = findFileByName(fileName, [
      cwd || '',
      defaultWorkingDir,
      join(app.getPath('userData'), 'default_working_dir'),
    ]);

    if (discoveredPath) {
      logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
        requested: normalizedPath,
        discoveredPath,
      });
      if (process.platform === 'darwin') {
        try {
          execFileSync('open', ['-R', discoveredPath]);
        } catch (error) {
          logWarn(
            '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
            error
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
      }
      return true;
    }

    logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
    return false;
  } catch (error) {
    logError('[shell.showItemInFolder] failed:', error);
    return false;
  }
}

ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
  return revealFileInFolder(filePath, cwd);
});

ipcMain.handle(
  'artifacts.listRecentFiles',
  async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
    if (!cwd || !isAbsolute(cwd)) {
      return [];
    }
    return listRecentWorkspaceFiles(cwd, sinceMs, limit);
  }
);

ipcMain.handle('dialog.selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files',
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// License (offline Ed25519) IPC handlers
ipcMain.handle('license.status', () => {
  try {
    const key = getStoredLicenseKey();
    if (!key) return { valid: false, reason: 'Chưa kích hoạt', machineId: getMachineId() };
    const status = verifyLicenseKey(key);
    return { ...status, machineId: getMachineId() };
  } catch (error) {
    logError('[License] status error:', error);
    return { valid: false, reason: 'Lỗi kiểm tra license', machineId: '' };
  }
});

ipcMain.handle('license.activate', (_event, key: string) => {
  try {
    const status = verifyLicenseKey(typeof key === 'string' ? key : '');
    if (status.valid) {
      setStoredLicenseKey(key);
    }
    return { ...status, machineId: getMachineId() };
  } catch (error) {
    logError('[License] activate error:', error);
    return { valid: false, reason: 'Lỗi kích hoạt license', machineId: getMachineId() };
  }
});

ipcMain.handle('license.deactivate', () => {
  try {
    clearStoredLicenseKey();
    return { ok: true };
  } catch (error) {
    logError('[License] deactivate error:', error);
    return { ok: false };
  }
});

ipcMain.handle('license.machineId', () => {
  try {
    return getMachineId();
  } catch {
    return '';
  }
});

// Token & cost usage log (per question)
ipcMain.handle('usage.getLog', () => {
  try {
    return getTokenUsageLog();
  } catch (error) {
    logError('[TokenUsage] getLog error:', error);
    return [];
  }
});

// BI Reports (saved dashboards: static snapshot + dynamic MCP-driven template)
ipcMain.handle('bi.list', () => {
  try {
    return listReports();
  } catch (error) {
    logError('[BIReport] list error:', error);
    return [];
  }
});

ipcMain.handle('bi.get', (_event, id: string) => {
  try {
    return getReport(id);
  } catch (error) {
    logError('[BIReport] get error:', error);
    return null;
  }
});

ipcMain.handle('bi.saveStatic', (_event, input: SaveStaticReportInput) => {
  try {
    return saveStaticReport(input);
  } catch (error) {
    logError('[BIReport] saveStatic error:', error);
    throw error;
  }
});

ipcMain.handle('bi.saveDynamic', async (_event, input: SaveDynamicReportInput) => {
  try {
    // Convert the dashboard into a refreshable template (params + per-chart
    // queries + a shell reading window.__REPORT_DATA__). Falls back to the raw
    // snapshot if the builder cannot produce a usable template.
    const built = await buildReportTemplate({
      html: input.htmlContent,
      capturedQueries: input.queries ?? [],
      isAi: false,
    });
    return saveDynamicReport({
      ...input,
      htmlContent: built?.shellHtml ?? input.htmlContent,
      params: built?.params ?? input.params ?? [],
      queries: built?.queries ?? input.queries ?? [],
    });
  } catch (error) {
    logError('[BIReport] saveDynamic error:', error);
    throw error;
  }
});

ipcMain.handle('bi.saveAi', async (_event, input: SaveAiReportInput) => {
  try {
    const built = await buildReportTemplate({
      html: input.htmlContent,
      capturedQueries: input.queries ?? [],
      isAi: true,
    });
    return saveAiReport({
      ...input,
      htmlContent: built?.shellHtml ?? input.htmlContent,
      params: built?.params ?? input.params ?? [],
      queries: built?.queries ?? input.queries ?? [],
    });
  } catch (error) {
    logError('[BIReport] saveAi error:', error);
    throw error;
  }
});

ipcMain.handle('bi.analyzeSession', (_event, sessionId: string) => {
  try {
    if (!sessionId || !sessionManager) {
      return { queries: [], queryCount: 0, prompt: null };
    }
    const traceSteps = sessionManager.getTraceSteps(sessionId) as unknown as Array<{
      toolName?: string;
      toolInput?: Record<string, unknown>;
      type?: string;
    }>;
    const messages = sessionManager.getMessages(sessionId) as unknown as Array<{
      role: string;
      content: unknown;
    }>;
    const mcp = sessionManager.getMCPManager();
    const toolMap = new Map<string, string>();
    if (mcp) {
      for (const t of mcp.getTools()) toolMap.set(t.name, t.serverName);
    }
    return analyzeSessionForReport(traceSteps, toolMap, messages);
  } catch (error) {
    logError('[BIReport] analyzeSession error:', error);
    return { queries: [], queryCount: 0, prompt: null };
  }
});

ipcMain.handle(
  'bi.duplicate',
  (_event, id: string, title: string, description: string | null) => {
    try {
      return duplicateReport(id, title, description ?? null);
    } catch (error) {
      logError('[BIReport] duplicate error:', error);
      throw error;
    }
  }
);

ipcMain.handle('bi.rename', (_event, id: string, title: string) => {
  try {
    renameReport(id, title);
    return { ok: true };
  } catch (error) {
    logError('[BIReport] rename error:', error);
    return { ok: false };
  }
});

ipcMain.handle('bi.delete', (_event, id: string) => {
  try {
    deleteReport(id);
    return { ok: true };
  } catch (error) {
    logError('[BIReport] delete error:', error);
    return { ok: false };
  }
});

ipcMain.handle(
  'bi.render',
  async (_event, id: string, paramValues?: Record<string, string | number>) => {
    try {
      const mcp = sessionManager?.getMCPManager() ?? null;
      return await renderReport(id, paramValues, mcp);
    } catch (error) {
      logError('[BIReport] render error:', error);
      throw error;
    }
  }
);

// Branding (white-label name + logo) IPC handlers
ipcMain.handle('branding.get', () => {
  try {
    return getBranding();
  } catch (error) {
    logError('[Branding] Error getting branding:', error);
    return { appName: '', logoDataUrl: '' };
  }
});

ipcMain.handle('branding.setName', (_event, name: string) => {
  try {
    return setAppName(typeof name === 'string' ? name : '');
  } catch (error) {
    logError('[Branding] Error setting name:', error);
    return getBranding();
  }
});

ipcMain.handle('branding.pickLogo', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select Logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return getBranding();
    }
    const filePath = result.filePaths[0];
    const buf = fs.readFileSync(filePath);
    if (buf.length > 2 * 1024 * 1024) {
      logWarn('[Branding] Logo file too large (max 2MB), ignoring:', filePath);
      return getBranding();
    }
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const mime =
      ext === 'svg'
        ? 'image/svg+xml'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/png';
    return setLogoDataUrl(`data:${mime};base64,${buf.toString('base64')}`);
  } catch (error) {
    logError('[Branding] Error picking logo:', error);
    return getBranding();
  }
});

ipcMain.handle('branding.resetLogo', () => {
  try {
    return clearLogo();
  } catch (error) {
    logError('[Branding] Error resetting logo:', error);
    return getBranding();
  }
});

// Config IPC handlers
ipcMain.handle('config.get', () => {
  try {
    return configStore.getAll();
  } catch (error) {
    logError('[Config] Error getting config:', error);
    return {};
  }
});

ipcMain.handle('config.getPresets', () => {
  try {
    return getPiAiModelPresets();
  } catch (error) {
    logError('[Config] Error getting presets:', error);
    return [];
  }
});

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
    memoryEnabled: config.memoryEnabled,
    memoryRuntime: config.memoryRuntime,
  });

const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  // Mark as configured if any config set has usable credentials
  configStore.set('isConfigured', configStore.hasAnyUsableCredentials());

  // Apply to environment
  configStore.applyToEnv();

  const updatedConfig = configStore.getAll();
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (sessionManager) {
    if (shouldReloadRunner) {
      sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await sessionManager
        .reloadSandbox()
        .catch((err) => logError('[Config] Sandbox reload failed:', err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        '[Config] Session manager config synced:',
        JSON.stringify({ runnerReloaded: shouldReloadRunner, sandboxReloaded: shouldReloadSandbox })
      );
    }
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
  return updatedConfig;
};

ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
  log('[Config] Saving config:', {
    ...newConfig,
    apiKey: newConfig.apiKey ? '***' : '',
    memoryRuntime: newConfig.memoryRuntime
      ? {
          ...newConfig.memoryRuntime,
          llm: newConfig.memoryRuntime.llm
            ? {
                ...newConfig.memoryRuntime.llm,
                apiKey: newConfig.memoryRuntime.llm.apiKey ? '***' : '',
              }
            : undefined,
          embedding: newConfig.memoryRuntime.embedding
            ? {
                ...newConfig.memoryRuntime.embedding,
                apiKey: newConfig.memoryRuntime.embedding.apiKey ? '***' : '',
              }
            : undefined,
        }
      : undefined,
  });

  const previousConfig = configStore.getAll();
  // Update config
  configStore.update(newConfig);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);

  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
  log('[Config] Creating config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.createSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.renameSet', async (_event, payload: { id: string; name: string }) => {
  log('[Config] Renaming config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.renameSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.deleteSet', async (_event, payload: { id: string }) => {
  log('[Config] Deleting config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.deleteSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.switchSet', async (_event, payload: { id: string }) => {
  log('[Config] Switching config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.switchSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.isConfigured', () => {
  try {
    return configStore.isConfigured();
  } catch (error) {
    logError('[Config] Error checking configured status:', error);
    return false;
  }
});

ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
  try {
    return await runConfigApiTest(payload, configStore.getAll());
  } catch (error) {
    logError('[Config] API test failed:', error);
    return {
      ok: false,
      errorType: 'unknown',
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle(
  'config.listModels',
  async (
    _event,
    payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
  ): Promise<ProviderModelInfo[]> => {
    if (payload.provider === 'ollama') {
      return listOllamaModels(payload);
    }
    // OpenAI-compatible endpoints (built-in OpenAI, or Custom w/ OpenAI protocol
    // such as FPT AI Marketplace) expose GET {baseUrl}/models.
    if (payload.provider === 'openai' || payload.provider === 'custom') {
      const { listOpenAICompatibleModels } = await import('./config/openai-models');
      return listOpenAICompatibleModels(payload);
    }
    return [];
  }
);

ipcMain.handle('config.diagnose', async (_event, payload: DiagnosticInput) => {
  try {
    const { runDiagnostics } = await import('./config/api-diagnostics');
    return await runDiagnostics(payload);
  } catch (error) {
    logError('[Config] Error running diagnostics:', error);
    throw error;
  }
});

ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
  try {
    const { discoverLocalOllama } = await import('./config/api-diagnostics');
    return await discoverLocalOllama(payload);
  } catch (error) {
    logError('[Config] Error discovering local services:', error);
    return [];
  }
});

// MCP Server IPC handlers
ipcMain.handle('mcp.getServers', () => {
  try {
    return mcpConfigStore.getServers();
  } catch (error) {
    logError('[MCP] Error getting servers:', error);
    return [];
  }
});

ipcMain.handle('mcp.getServer', (_event, serverId: string) => {
  try {
    return mcpConfigStore.getServer(serverId);
  } catch (error) {
    logError('[MCP] Error getting server:', error);
    return null;
  }
});

ipcMain.handle('mcp.saveServer', async (_event, config: MCPServerConfig) => {
  mcpConfigStore.saveServer(config);
  // Update only this specific server, not all servers
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.updateServer(config);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${config.name} updated successfully`);
    } catch (err) {
      logError('[MCP] Failed to update server:', err);
      // Roll back: save the config with enabled=false so a broken connector
      // is not retried on next app startup
      if (config.enabled) {
        mcpConfigStore.saveServer({ ...config, enabled: false });
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMessage };
    }
  }
  return { success: true };
});

ipcMain.handle('mcp.deleteServer', async (_event, serverId: string) => {
  mcpConfigStore.deleteServer(serverId);
  // Remove and disconnect only this specific server
  if (sessionManager) {
    const mcpManager = sessionManager.getMCPManager();
    try {
      await mcpManager.removeServer(serverId);
      sessionManager.invalidateMcpServersCache();
      log(`[MCP] Server ${serverId} removed successfully`);
    } catch (err) {
      logError('[MCP] Failed to remove server:', err);
    }
  }
  return { success: true };
});

ipcMain.handle('mcp.getTools', () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getTools();
  } catch (error) {
    logError('[MCP] Error getting tools:', error);
    return [];
  }
});

ipcMain.handle('mcp.getServerStatus', () => {
  try {
    if (!sessionManager) {
      return [];
    }
    const mcpManager = sessionManager.getMCPManager();
    return mcpManager.getServerStatus();
  } catch (error) {
    logError('[MCP] Error getting server status:', error);
    return [];
  }
});

ipcMain.handle('mcp.getDisabledTools', () => {
  try {
    return mcpConfigStore.getDisabledTools();
  } catch (error) {
    logError('[MCP] Error getting disabled tools:', error);
    return [];
  }
});

ipcMain.handle(
  'mcp.setToolEnabled',
  (_event, payload: { toolName: string; enabled: boolean }) => {
    try {
      mcpConfigStore.setToolEnabled(payload.toolName, payload.enabled);
      return { success: true };
    } catch (error) {
      logError('[MCP] Error setting tool enabled:', error);
      return { success: false };
    }
  }
);

ipcMain.handle('mcp.getPresets', () => {
  try {
    return mcpConfigStore.getPresets();
  } catch (error) {
    logError('[MCP] Error getting presets:', error);
    return {};
  }
});

// Per-chat MCP selection: persist which MCP servers are turned off for a session.
ipcMain.handle(
  'mcp.setSessionSelection',
  (_event, payload: { sessionId: string; disabledServerIds: string[] }) => {
    try {
      if (sessionManager) {
        sessionManager.setSessionMcpSelection(payload.sessionId, payload.disabledServerIds);
      }
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError('[MCP] Error setting session MCP selection:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
);

// Default per-chat MCP selection for NEW chats (chosen on the welcome screen).
ipcMain.handle('mcp.getDefaultSelection', () => {
  try {
    return { disabledServerIds: mcpConfigStore.getDefaultDisabledServers() };
  } catch (error) {
    logError('[MCP] Error getting default MCP selection:', error);
    return { disabledServerIds: [] };
  }
});

ipcMain.handle('mcp.setDefaultSelection', (_event, payload: { disabledServerIds: string[] }) => {
  try {
    mcpConfigStore.setDefaultDisabledServers(payload.disabledServerIds);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('[MCP] Error setting default MCP selection:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

// Run the interactive OAuth 2.1 flow for an HTTP/SSE MCP server (login once at
// assignment time). Persists the server config first, then opens the browser.
ipcMain.handle('mcp.authenticate', async (_event, config: MCPServerConfig) => {
  try {
    mcpConfigStore.saveServer(config);
    if (!sessionManager) {
      return { success: false, error: 'Session manager not ready' };
    }
    const mcpManager = sessionManager.getMCPManager();
    const result = await mcpManager.authenticateServer(config);
    sessionManager.invalidateMcpServersCache();
    log(`[MCP] OAuth authentication completed for ${config.name}`);
    return { success: true, ...result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('[MCP] OAuth authentication failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('mcp.getOAuthStatus', (_event, serverId: string) => {
  try {
    if (!sessionManager) {
      return { authenticated: false };
    }
    return sessionManager.getMCPManager().getOAuthStatus(serverId);
  } catch (error) {
    logError('[MCP] Error getting OAuth status:', error);
    return { authenticated: false };
  }
});

ipcMain.handle('mcp.clearOAuth', async (_event, serverId: string) => {
  try {
    if (sessionManager) {
      await sessionManager.getMCPManager().clearOAuth(serverId);
      sessionManager.invalidateMcpServersCache();
    }
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('[MCP] Error clearing OAuth:', errorMessage);
    return { success: false, error: errorMessage };
  }
});

// Skills API handlers
ipcMain.handle('skills.getAll', async () => {
  try {
    if (!skillsManager) {
      throw new Error('Skills manager is still starting');
    }
    return await skillsManager.listSkills();
  } catch (error) {
    logError('[Skills] Error getting skills:', error);
    throw error;
  }
});

ipcMain.handle('skills.install', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const skill = await skillsManager.installSkill(skillPath);
    sessionManager?.invalidateSkillsSetup();
    return { success: true, skill };
  } catch (error) {
    logError('[Skills] Error installing skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.delete', async (_event, skillId: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    await skillsManager.uninstallSkill(skillId);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error deleting skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    skillsManager.setSkillEnabled(skillId, enabled);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error toggling skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      return { valid: false, errors: ['SkillsManager not initialized'] };
    }
    const result = await skillsManager.validateSkillFolder(skillPath);
    return result;
  } catch (error) {
    logError('[Skills] Error validating skill:', error);
    return { valid: false, errors: ['Validation failed'] };
  }
});

ipcMain.handle('skills.getStoragePath', async () => {
  try {
    if (!skillsManager) {
      return null;
    }
    return skillsManager.getGlobalSkillsPath();
  } catch (error) {
    logError('[Skills] Error getting storage path:', error);
    return null;
  }
});

ipcMain.handle('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const result = await skillsManager.setGlobalSkillsPath(targetPath, migrate !== false);
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
  return { success: true, ...result };
});

ipcMain.handle('skills.openStoragePath', async () => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const storagePath = skillsManager.getGlobalSkillsPath();
  const openResult = await shell.openPath(storagePath);
  if (openResult) {
    return { success: false, path: storagePath, error: openResult };
  }
  return { success: true, path: storagePath };
});

ipcMain.handle('plugins.listCatalog', async (_event, options?: { installableOnly?: boolean }) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    return await pluginRuntimeService.listCatalog(options);
  } catch (error) {
    logError('[Plugins] Error listing catalog:', error);
    throw error;
  }
});

ipcMain.handle('plugins.listInstalled', async () => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    return pluginRuntimeService.listInstalled();
  } catch (error) {
    logError('[Plugins] Error listing installed plugins:', error);
    throw error;
  }
});

ipcMain.handle('plugins.install', async (_event, pluginName: string) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.install(pluginName);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error installing plugin:', error);
    throw error;
  }
});

ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.setEnabled(pluginId, enabled);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error toggling plugin:', error);
    throw error;
  }
});

ipcMain.handle(
  'plugins.setComponentEnabled',
  async (
    _event,
    pluginId: string,
    component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp',
    enabled: boolean
  ) => {
    try {
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.setComponentEnabled(pluginId, component, enabled);
      if (component === 'skills') {
        sessionManager?.invalidateSkillsSetup();
      }
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin component:', error);
      throw error;
    }
  }
);

ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
  try {
    if (!pluginRuntimeService) {
      throw new Error('PluginRuntimeService not initialized');
    }
    const result = await pluginRuntimeService.uninstall(pluginId);
    sessionManager?.invalidateSkillsSetup();
    return result;
  } catch (error) {
    logError('[Plugins] Error uninstalling plugin:', error);
    throw error;
  }
});

// Window control IPC handlers
ipcMain.on('window.minimize', () => {
  try {
    mainWindow?.minimize();
  } catch (error) {
    logError('[Window] Error minimizing:', error);
  }
});

ipcMain.on('window.maximize', () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  } catch (error) {
    logError('[Window] Error maximizing:', error);
  }
});

ipcMain.on('window.close', () => {
  try {
    mainWindow?.close();
  } catch (error) {
    logError('[Window] Error closing:', error);
  }
});

// Sandbox IPC handlers
ipcMain.handle('sandbox.getStatus', async () => {
  try {
    const adapter = getSandboxAdapter();
    const platform = process.platform;

    if (platform === 'win32') {
      const wslStatus = await WSLBridge.checkWSLStatus();
      return {
        platform: 'win32',
        mode: adapter.initialized ? adapter.mode : 'none',
        initialized: adapter.initialized,
        wsl: wslStatus,
        lima: null,
      };
    } else if (platform === 'darwin') {
      const limaStatus = await LimaBridge.checkLimaStatus();
      return {
        platform: 'darwin',
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: limaStatus,
      };
    } else {
      return {
        platform,
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: null,
      };
    }
  } catch (error) {
    logError('[Sandbox] Error getting status:', error);
    return {
      platform: process.platform,
      mode: 'none',
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// WSL IPC handlers (Windows)
ipcMain.handle('sandbox.checkWSL', async () => {
  try {
    return await WSLBridge.checkWSLStatus();
  } catch (error) {
    logError('[Sandbox] Error checking WSL:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installNodeInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Node.js:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installPythonInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Python:', error);
    return false;
  }
});

// Lima IPC handlers (macOS)
ipcMain.handle('sandbox.checkLima', async () => {
  try {
    return await LimaBridge.checkLimaStatus();
  } catch (error) {
    logError('[Sandbox] Error checking Lima:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.createLimaInstance', async () => {
  try {
    return await LimaBridge.createLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error creating Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.startLimaInstance', async () => {
  try {
    return await LimaBridge.startLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error starting Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.stopLimaInstance', async () => {
  try {
    return await LimaBridge.stopLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error stopping Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installNodeInLima', async () => {
  try {
    return await LimaBridge.installNodeInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Node.js in Lima:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInLima', async () => {
  try {
    return await LimaBridge.installPythonInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Python in Lima:', error);
    return false;
  }
});

// Logs IPC handlers
ipcMain.handle('logs.getPath', () => {
  try {
    return getLogFilePath();
  } catch (error) {
    logError('[Logs] Error getting log path:', error);
    return null;
  }
});

ipcMain.handle('logs.getDirectory', () => {
  try {
    return getLogsDirectory();
  } catch (error) {
    logError('[Logs] Error getting logs directory:', error);
    return null;
  }
});

ipcMain.handle('logs.getAll', () => {
  try {
    return getAllLogFiles();
  } catch (error) {
    logError('[Logs] Error getting all log files:', error);
    return [];
  }
});

ipcMain.handle('logs.export', async () => {
  try {
    const logFiles = getAllLogFiles();
    const diagnosticsSummary = buildDiagnosticsSummary({
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
      },
      runtime: {
        currentWorkingDir,
        logsDirectory: getLogsDirectory(),
        logFileCount: logFiles.length,
        totalLogSizeBytes: logFiles.reduce((total, file) => total + file.size, 0),
        devLogsEnabled: isDevLogsEnabled(),
      },
      config: {
        provider: configStore.get('provider'),
        model: configStore.get('model'),
        baseUrl: sanitizeDiagnosticBaseUrl(configStore.get('baseUrl') || undefined),
        customProtocol: configStore.get('customProtocol') || null,
        sandboxEnabled: !!configStore.get('sandboxEnabled'),
        thinkingEnabled: !!configStore.get('enableThinking'),
        apiKeyConfigured: !!configStore.get('apiKey'),
        claudeCodePathConfigured: !!configStore.get('claudeCodePath'),
        defaultWorkdir: configStore.get('defaultWorkdir') || null,
        globalSkillsPathConfigured: !!configStore.get('globalSkillsPath'),
      },
      sandbox: {
        mode: getSandboxAdapter().mode,
        initialized: getSandboxAdapter().initialized,
      },
      sessions: sessionManager ? sessionManager.listSessions() : [],
      logFiles,
      deps: {
        getMessages: (sessionId: string) =>
          sessionManager ? sessionManager.getMessages(sessionId) : [],
        getTraceSteps: (sessionId: string) =>
          sessionManager ? sessionManager.getTraceSteps(sessionId) : [],
      },
    });

    // Show save dialog
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Logs',
      defaultPath: `ai-ierp-logs-${new Date().toISOString().split('T')[0]}.zip`,
      filters: [
        { name: 'ZIP Archive', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'User cancelled' };
    }

    // Dynamic import archiver
    const archiver = await import('archiver');
    const output = fs.createWriteStream(result.filePath);
    const archive = archiver.default('zip', { zlib: { level: 9 } });

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value: {
        success: boolean;
        path?: string;
        size?: number;
        error?: string;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      output.on('close', () => {
        log('[Logs] Exported logs to:', result.filePath);
        settle({
          success: true,
          path: result.filePath,
          size: archive.pointer(),
        });
      });

      output.on('error', (err: Error) => {
        logError('[Logs] Error writing exported archive:', err);
        settle({ success: false, error: err.message });
      });

      archive.on('error', (err: Error) => {
        logError('[Logs] Error creating archive:', err);
        settle({ success: false, error: err.message });
      });

      archive.pipe(output);

      // Add all log files
      for (const logFile of logFiles) {
        archive.file(logFile.path, { name: logFile.name });
      }

      // Add system info
      const systemInfo = {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
        exportDate: new Date().toISOString(),
        logFiles: logFiles.map((f) => ({
          name: f.name,
          size: f.size,
          modified: f.mtime,
        })),
      };
      archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });
      archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
        name: 'diagnostics-summary.json',
      });
      archive.append(
        [
          'Open Cowork diagnostic bundle',
          `Exported at: ${diagnosticsSummary.exportedAt}`,
          '',
          'Included files:',
          '- Application log files (*.log)',
          '- system-info.json',
          '- diagnostics-summary.json',
          '',
          'diagnostics-summary.json contains a redacted runtime/config snapshot,',
          'plus metadata-only session summaries and recent error traces to speed up debugging.',
        ].join('\n'),
        { name: 'README.txt' }
      );

      archive.finalize();
    });
  } catch (error) {
    logError('[Logs] Error exporting logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.open', async () => {
  try {
    const logsDir = getLogsDirectory();
    await shell.openPath(logsDir);
    return { success: true };
  } catch (error) {
    logError('[Logs] Error opening logs directory:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.clear', async () => {
  try {
    const logFiles = getAllLogFiles();

    // Close current log file
    closeLogFile();

    // Delete all log files
    for (const logFile of logFiles) {
      try {
        fs.unlinkSync(logFile.path);
        log('[Logs] Deleted log file:', logFile.name);
      } catch (err) {
        logError('[Logs] Failed to delete log file:', logFile.name, err);
      }
    }

    // Log will automatically reinitialize on next log call
    log('[Logs] Log files cleared and reinitialized');

    return { success: true, deletedCount: logFiles.length };
  } catch (error) {
    logError('[Logs] Error clearing logs:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
  try {
    setDevLogsEnabled(enabled);
    configStore.set('enableDevLogs', enabled);
    log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
    return { success: true, enabled };
  } catch (error) {
    logError('[Logs] Error setting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('logs.isEnabled', () => {
  try {
    return { success: true, enabled: isDevLogsEnabled() };
  } catch (error) {
    logError('[Logs] Error getting dev logs enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// ============================================================================
// Remote control IPC handlers
// ============================================================================

ipcMain.handle('remote.getConfig', () => {
  try {
    return remoteConfigStore.getAll();
  } catch (error) {
    logError('[Remote] Error getting config:', error);
    return null;
  }
});

ipcMain.handle('remote.getStatus', () => {
  try {
    return remoteManager.getStatus();
  } catch (error) {
    logError('[Remote] Error getting status:', error);
    return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
  }
});

ipcMain.handle('remote.setEnabled', async (_event, enabled: boolean) => {
  try {
    remoteConfigStore.setEnabled(enabled);

    if (enabled) {
      await remoteManager.start();
    } else {
      await remoteManager.stop();
    }

    return { success: true };
  } catch (error) {
    logError('[Remote] Error setting enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
  try {
    await remoteManager.updateGatewayConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating gateway config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateFeishuConfig', async (_event, config: FeishuChannelConfig) => {
  try {
    await remoteManager.updateFeishuConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating Feishu config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getPairedUsers', () => {
  try {
    return remoteManager.getPairedUsers();
  } catch (error) {
    logError('[Remote] Error getting paired users:', error);
    return [];
  }
});

ipcMain.handle('remote.getPendingPairings', () => {
  try {
    return remoteManager.getPendingPairings();
  } catch (error) {
    logError('[Remote] Error getting pending pairings:', error);
    return [];
  }
});

ipcMain.handle('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.approvePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error approving pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.revokePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error revoking pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.rejectPairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.rejectPairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error rejecting pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getRemoteSessions', () => {
  try {
    return remoteManager.getRemoteSessions();
  } catch (error) {
    logError('[Remote] Error getting remote sessions:', error);
    return [];
  }
});

ipcMain.handle('remote.clearRemoteSession', (_event, sessionId: string) => {
  try {
    const success = remoteManager.clearRemoteSession(sessionId);
    return { success };
  } catch (error) {
    logError('[Remote] Error clearing remote session:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getTunnelStatus', () => {
  try {
    return remoteManager.getTunnelStatus();
  } catch (error) {
    logError('[Remote] Error getting tunnel status:', error);
    return { connected: false, url: null, provider: 'none' };
  }
});

ipcMain.handle('remote.getWebhookUrl', () => {
  try {
    return remoteManager.getFeishuWebhookUrl();
  } catch (error) {
    logError('[Remote] Error getting webhook URL:', error);
    return null;
  }
});

ipcMain.handle('remote.restart', async () => {
  try {
    await remoteManager.restart();
    return { success: true };
  } catch (error) {
    logError('[Remote] Error restarting:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('schedule.list', () => {
  try {
    if (!scheduledTaskManager) return [];
    return scheduledTaskManager.list();
  } catch (error) {
    logError('[Schedule] Error listing tasks:', error);
    return [];
  }
});

ipcMain.handle('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = payload.prompt.trim();
  const title = await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd, payload.title);
  return scheduledTaskManager.create({
    ...payload,
    prompt: normalizedPrompt,
    title,
  });
});

ipcMain.handle('schedule.update', async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const existing = scheduledTaskManager.get(id);
  if (!existing) return null;
  const nextCwd = updates.cwd ?? existing.cwd;
  const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
  const normalizedUpdates: ScheduledTaskUpdateInput = {
    ...updates,
    prompt: normalizedPrompt,
  };

  if (updates.prompt !== undefined) {
    normalizedUpdates.title = await resolveScheduledTaskTitle(
      normalizedPrompt,
      updates.cwd ?? existing.cwd,
      updates.title ?? existing.title
    );
  } else if (updates.title !== undefined) {
    normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
  }

  return scheduledTaskManager.update(id, normalizedUpdates);
});

ipcMain.handle('schedule.delete', (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return { success: scheduledTaskManager.delete(id) };
});

ipcMain.handle('schedule.toggle', (_event, id: string, enabled: boolean) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.toggle(id, enabled);
});

ipcMain.handle('schedule.runNow', async (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.runNow(id);
});

ipcMain.handle('memory.getOverview', (_event, cwd?: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.getOverview(cwd);
});

ipcMain.handle(
  'memory.search',
  (
    _event,
    payload: {
      query: string;
      cwd?: string;
      sourceWorkspace?: string | null;
      scope?: 'workspace' | 'global' | 'all';
      limit?: number;
    }
  ) => {
    if (!memoryService) {
      throw new Error('Memory service not initialized');
    }
    return memoryService.search(payload);
  }
);

ipcMain.handle('memory.read', (_event, id: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.read(id);
});

ipcMain.handle('memory.rebuildWorkspace', async (_event, cwd: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.rebuildWorkspace(cwd);
});

ipcMain.handle('memory.clearWorkspace', (_event, cwd: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.clearWorkspace(cwd);
});

ipcMain.handle('memory.clearCoreMemory', () => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.clearCoreMemory();
});

ipcMain.handle('memory.rebuildAll', async () => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.rebuildAll();
});

ipcMain.handle('memory.listFiles', () => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.listFiles();
});

ipcMain.handle('memory.readFile', (_event, filePath: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.readFile(filePath);
});

ipcMain.handle('memory.inspectSession', (_event, sessionId: string, workspaceKey?: string) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  return memoryService.inspectSession(sessionId, workspaceKey);
});

ipcMain.handle('memory.setEnabled', (_event, enabled: boolean) => {
  if (!memoryService) {
    throw new Error('Memory service not initialized');
  }
  const result = memoryService.setEnabled(enabled);
  sessionManager?.clearAllCachedAgentSessions();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
  return result;
});

ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: unknown[]) => {
  try {
    if (level === 'warn') {
      logWarn(...args);
    } else if (level === 'error') {
      logError(...args);
    } else {
      log(...args);
    }
    return { success: true };
  } catch (error) {
    console.error('[Logs] Error writing log:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.retryLimaSetup', async () => {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Lima is only available on macOS' };
  }

  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    try {
      await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima before retry:', error);
    }

    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying Lima setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Generic retry setup for both WSL and Lima
ipcMain.handle('sandbox.retrySetup', async () => {
  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    // Reset and re-run bootstrap
    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // License enforcement (defense-in-depth): the renderer LicenseGate is only UX
  // and can be bypassed via DevTools — so refuse to run any agent session in the
  // main process unless a valid license is active.
  if (event.type === 'session.start' || event.type === 'session.continue') {
    const lic = verifyLicenseKey(getStoredLicenseKey());
    if (!lic.valid) {
      sendToRenderer({
        type: 'error',
        payload: {
          message: 'Ứng dụng chưa được kích hoạt license hợp lệ. Vui lòng nhập license key.',
          code: 'LICENSE_REQUIRED',
          action: 'open_license',
        },
      });
      return null;
    }
  }

  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendToRenderer({
      type: 'error',
      payload: {
        message:
          'Phương án hiện tại chưa cấu hình thông tin xác thực khả dụng. Vui lòng hoàn tất cấu hình trong phần Cài đặt API.',
        code: 'CONFIG_REQUIRED_ACTIVE_SET',
        action: 'open_api_settings',
      },
    });
    return null;
  }

  if (eventRequiresSessionManager(event) && !sessionManager) {
    throw new Error('Session manager not initialized');
  }
  // After the guard above, sessionManager is guaranteed non-null for session.* events.
  // Use a local alias to satisfy TypeScript's control-flow narrowing.
  const sm = sessionManager!;

  switch (event.type) {
    case 'session.start':
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.memoryEnabled
      );

    case 'session.continue':
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content
      );

    case 'session.stop':
      return sm.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sm.deleteSession(event.payload.sessionId);

    case 'session.batchDelete':
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case 'session.list': {
      const sessions = sm.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

    case 'session.getMessages':
      return sm.getMessages(event.payload.sessionId);

    case 'session.getTraceSteps':
      return sm.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

    case 'sudo.password.response':
      return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

    case 'folder.select': {
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update':
      if (
        event.payload.theme === 'dark' ||
        event.payload.theme === 'light' ||
        event.payload.theme === 'system'
      ) {
        const nextTheme = event.payload.theme as AppTheme;
        configStore.update({ theme: nextTheme });
        applyNativeThemePreference(nextTheme);
        if (mainWindow && !mainWindow.isDestroyed()) {
          const effectiveTheme = resolveEffectiveTheme(nextTheme);
          mainWindow.setBackgroundColor(effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG);
        }
        sendToRenderer({
          type: 'config.status',
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
      }

      if (Array.isArray((event.payload as { permissionRules?: unknown }).permissionRules)) {
        setPermissionRules(
          (event.payload as { permissionRules: PermissionRule[] }).permissionRules
        );
      }
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
