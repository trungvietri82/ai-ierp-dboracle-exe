import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { resolveArtifactPath } from '../utils/artifact-path';
import { extractFilePathFromToolInput, extractFilePathFromToolOutput } from '../utils/tool-output-path';
import { getArtifactLabel, getArtifactIconComponent, getArtifactSteps } from '../utils/artifact-steps';
import { isPreviewableFile } from '../utils/preview-file';
import { useIPC } from '../hooks/useIPC';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  FilePieChart,
  FileCode2,
  FileArchive,
  FileAudio2,
  FileVideo,
  Image as ImageIcon,
  FolderOpen,
  FolderSync,
  File,
  Check,
  Loader2,
  Wrench,
  MessageSquare,
  Cpu,
  Copy,
  Layers,
  ListTodo,
  Square,
  CheckSquare,
  XCircle,
} from 'lucide-react';
import type { TraceStep, ContentBlock, ToolUseContent } from '../types';
import type { TodoItem } from './message/types';

const EMPTY_STEPS: TraceStep[] = [];

export function ContextPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const appConfig = useAppStore((s) => s.appConfig);
  const contextPanelCollapsed = useAppStore((s) => s.contextPanelCollapsed);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const setPreviewFile = useAppStore((s) => s.setPreviewFile);
  const { changeWorkingDir } = useIPC();
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [progressOpen, setProgressOpen] = useState(true);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<Array<{
    path: string;
    modifiedAt: number;
    size: number;
  }>>([]);

  const handleCopyPath = async (path: string) => {
    try {
      // Escape spaces for shell usage so the path can be pasted into terminal
      let shellPath = path;
      if (path.includes(' ')) {
        const isWindows = window.electronAPI?.platform === 'win32';
        shellPath = isWindows ? `"${path}"` : path.replace(/ /g, '\\ ');
      }
      await navigator.clipboard.writeText(shellPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  const ss = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const steps = ss?.traceSteps ?? EMPTY_STEPS;
  const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const canShowItemInFolder = typeof window !== 'undefined' && !!window.electronAPI?.showItemInFolder;

  // Session info computations
  const messages = useMemo(
    () => (activeSessionId ? sessionStates[activeSessionId]?.messages || [] : []),
    [activeSessionId, sessionStates]
  );
  const messageCount = messages.length;
  const toolCallCount = steps.filter((s) => s.type === 'tool_call').length;
  const modelName = activeSession?.model || appConfig?.model || '—';

  // Token usage aggregation
  const tokenUsage = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const msg of messages) {
      if (msg.tokenUsage) {
        input += msg.tokenUsage.input || 0;
        output += msg.tokenUsage.output || 0;
      }
    }
    return { input, output, total: input + output };
  }, [messages]);

  // Context usage: last message's input tokens ≈ current context occupation
  const contextUsage = useMemo(() => {
    const contextWindow = activeSessionId ? sessionStates[activeSessionId]?.contextWindow : undefined;
    if (!contextWindow) return null;

    let lastInput = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].tokenUsage?.input) {
        lastInput = messages[i].tokenUsage!.input;
        break;
      }
    }
    if (lastInput === 0) return null;

    const percentage = Math.min((lastInput / contextWindow) * 100, 100);
    return { used: lastInput, total: contextWindow, percentage };
  }, [activeSessionId, sessionStates, messages]);

  const completedStepCount = useMemo(
    () => steps.reduce((n, s) => n + (s.status === 'completed' ? 1 : 0), 0),
    [steps]
  );

  // Latest plan: the most recent TodoWrite tool call's todo list for this session.
  // Start time of the CURRENT turn = the last user message. Used to scope the
  // Progress panel to the current prompt only, so it resets each turn instead of
  // piling up every step of the whole conversation.
  const currentTurnStart = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') return messages[i].timestamp;
    }
    return 0;
  }, [messages]);

  // Powers the "Progress" section so the user can watch the AI work through steps.
  // Only consider the current turn's TodoWrite (ignore stale plans from earlier turns).
  const latestTodos = useMemo<TodoItem[]>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.timestamp < currentTurnStart) break;
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'tool_use' && (block as ToolUseContent).name === 'TodoWrite') {
          const todos = (block as ToolUseContent).input?.todos;
          if (Array.isArray(todos)) return todos as TodoItem[];
        }
      }
    }
    return [];
  }, [messages, currentTurnStart]);
  const todoCompletedCount = latestTodos.filter((todo) => todo.status === 'completed').length;
  const todoProgress = latestTodos.length > 0 ? (todoCompletedCount / latestTodos.length) * 100 : 0;

  // Fallback "process" view: the actual tool-call steps the AI ran THIS turn.
  // Shown when the model didn't produce a TodoWrite plan, so the Progress panel
  // still reflects what the AI is doing (queries, file writes, …).
  const processSteps = useMemo(
    () => steps.filter((s) => s.type === 'tool_call' && s.timestamp >= currentTurnStart),
    [steps, currentTurnStart]
  );
  const processCompleted = processSteps.filter((s) => s.status === 'completed').length;
  const processProgress =
    processSteps.length > 0 ? (processCompleted / processSteps.length) * 100 : 0;

  useEffect(() => {
    if (contextPanelCollapsed) {
      return;
    }
    if (
      typeof window === 'undefined'
      || !window.electronAPI?.artifacts?.listRecentFiles
      || !currentWorkingDir
      || !activeSession?.createdAt
    ) {
      setRecentWorkspaceFiles([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const files = await window.electronAPI.artifacts.listRecentFiles(
          currentWorkingDir,
          activeSession.createdAt,
          50
        );
        if (!cancelled) {
          setRecentWorkspaceFiles(files || []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load recent workspace files:', error);
          setRecentWorkspaceFiles([]);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeSession?.createdAt,
    activeSessionId,
    steps.length,
    completedStepCount,
    contextPanelCollapsed,
    currentWorkingDir,
  ]);

  const displayArtifacts = useMemo(() => {
    const seenPaths = new Set<string>();
    const items: Array<{ label: string; path: string }> = [];
    // Normalize the dedupe key so the same file from two sources (tool output
    // uses '/', recent-files scan uses '\\', case differs on Windows) collapses
    // into one entry instead of appearing twice.
    const dedupeKey = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

    for (const step of displayArtifactSteps) {
      const fallbackPath = extractFilePathFromToolOutput(step.toolOutput)
        || extractFilePathFromToolInput(step.toolInput);
      if (!fallbackPath) {
        continue;
      }

      const resolvedPath = resolveArtifactPath(fallbackPath, currentWorkingDir);
      const key = dedupeKey(resolvedPath);
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(fallbackPath),
        path: resolvedPath,
      });
    }

    for (const file of recentWorkspaceFiles) {
      const resolvedPath = resolveArtifactPath(file.path, currentWorkingDir);
      const key = dedupeKey(resolvedPath);
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(file.path),
        path: resolvedPath,
      });
    }

    return items;
  }, [currentWorkingDir, displayArtifactSteps, recentWorkspaceFiles]);

  if (contextPanelCollapsed) {
    return (
      <div className="w-10 bg-background border-l border-border-muted flex items-start justify-center pt-3">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.expandPanel')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-background border-l border-border-muted flex flex-col overflow-hidden text-sm">
      {/* Header */}
      <div className="px-3 h-10 flex items-center gap-2 border-b border-border-muted shrink-0">
        <button
          onClick={toggleContextPanel}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.collapsePanel')}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t('context.context')}
        </span>
      </div>

      {/* Session Stats */}
      {activeSession && (
        <div className="px-4 py-3 border-b border-border-muted space-y-1.5">
          <div className="flex items-center gap-1.5 text-text-primary font-medium">
            <Cpu className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="truncate">{modelName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted pl-5">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {toolCallCount}
            </span>
            {tokenUsage.total > 0 && (
              <span className="ml-auto text-text-muted/70">
                {t('context.inputTokens')} {formatTokenCount(tokenUsage.input)} ·{' '}
                {t('context.outputTokens')} {formatTokenCount(tokenUsage.output)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Context Usage */}
      {activeSession && contextUsage && (
        <div className="px-4 py-2.5 border-b border-border-muted space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              {t('context.contextUsage')}
            </span>
            <span className={`text-xs font-medium ${
              contextUsage.percentage > 95 ? 'text-error' :
              contextUsage.percentage > 80 ? 'text-warning' :
              'text-text-primary'
            }`}>
              {Math.round(contextUsage.percentage)}%
            </span>
          </div>
          <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                contextUsage.percentage > 95 ? 'bg-error' :
                contextUsage.percentage > 80 ? 'bg-warning' :
                'bg-gradient-to-r from-accent to-accent-hover'
              }`}
              style={{ width: `${contextUsage.percentage}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            {t('context.contextUsageLabel', {
              used: formatTokenCount(contextUsage.used),
              total: formatTokenCount(contextUsage.total),
            })}
          </p>
        </div>
      )}

      {/* Progress / Plan — the AI's latest TodoWrite checklist (always shown so the
          user knows where to look; empty state hints what it's for). */}
      <div className="border-b border-border-muted">
        <button
          onClick={() => setProgressOpen(!progressOpen)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted uppercase tracking-wider">
            <ListTodo className="w-3.5 h-3.5" />
            {t('context.progress')}
          </span>
          <span className="flex items-center gap-2">
            {latestTodos.length > 0 ? (
              <span className="text-xs font-medium text-text-muted">
                {todoCompletedCount}/{latestTodos.length}
              </span>
            ) : processSteps.length > 0 ? (
              <span className="text-xs font-medium text-text-muted">
                {processCompleted}/{processSteps.length}
              </span>
            ) : null}
            {progressOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            )}
          </span>
        </button>
        {(latestTodos.length > 0 || processSteps.length > 0) && (
          <div className="h-0.5 bg-surface-muted">
            <div
              className="h-full bg-gradient-to-r from-accent to-accent-hover transition-all duration-500"
              style={{ width: `${latestTodos.length > 0 ? todoProgress : processProgress}%` }}
            />
          </div>
        )}
        {progressOpen &&
          (latestTodos.length > 0 ? (
            <div className="px-3 pb-2 pt-1.5 max-h-72 overflow-y-auto space-y-0.5">
              {latestTodos.map((todo, index) => (
                <div
                  key={todo.id || index}
                  className={`flex items-start gap-2 px-1.5 py-1 rounded ${
                    todo.status === 'in_progress' ? 'bg-accent/5' : ''
                  }`}
                >
                  <span className="mt-0.5 flex-shrink-0">{todoStatusIcon(todo.status)}</span>
                  <span className={`text-xs leading-snug ${todoStatusStyle(todo.status)}`}>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          ) : processSteps.length > 0 ? (
            <div className="px-3 pb-2 pt-1.5 max-h-72 overflow-y-auto space-y-0.5">
              {processSteps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-start gap-2 px-1.5 py-1 rounded ${
                    step.status === 'running' ? 'bg-accent/5' : ''
                  }`}
                >
                  <span className="mt-0.5 flex-shrink-0">{traceStatusIcon(step.status)}</span>
                  <span
                    className={`text-xs leading-snug ${
                      step.status === 'completed'
                        ? 'text-text-muted'
                        : step.status === 'error'
                          ? 'text-error'
                          : 'text-text-primary'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 pb-2.5 pt-0.5 text-xs text-text-muted leading-snug">
              {t('context.progressEmpty')}
            </div>
          ))}
      </div>

      {/* Artifacts Section */}
      <div className="border-b border-border-muted">
        <button
          onClick={() => setArtifactsOpen(!artifactsOpen)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('context.artifacts')}
          </span>
          {artifactsOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>

        {artifactsOpen && (
          <div className="pb-2 max-h-64 overflow-y-auto">
            {displayArtifacts.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>{t('context.noArtifactsYet')}</span>
              </div>
            ) : (
              <div>
                {displayArtifacts.map((artifact, index) => {
                  const label = artifact.label || t('context.fileCreated');
                  const artifactPath = artifact.path;
                  const canClick = Boolean(artifactPath && canShowItemInFolder);
                  const iconComponent = getArtifactIconComponent(label);
                  const IconComponent =
                    iconComponent === 'presentation' ? FilePieChart
                    : iconComponent === 'table' ? FileSpreadsheet
                    : iconComponent === 'document' ? FileText
                    : iconComponent === 'code' ? FileCode2
                    : iconComponent === 'image' ? ImageIcon
                    : iconComponent === 'audio' ? FileAudio2
                    : iconComponent === 'video' ? FileVideo
                    : iconComponent === 'archive' ? FileArchive
                    : iconComponent === 'text' ? File
                    : File;

                  return (
                    <div
                      key={artifact.path || artifact.label || `artifact-${index}`}
                      className={`flex items-center gap-2 px-4 py-1.5 transition-colors ${canClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
                      onClick={async () => {
                        if (!canClick) return;
                        // Previewable types open in the in-app preview panel.
                        if (isPreviewableFile(artifactPath)) {
                          setPreviewFile({ path: artifactPath, cwd: currentWorkingDir ?? undefined });
                          return;
                        }
                        // Otherwise open with the OS default app; fall back to revealing it.
                        const opened = window.electronAPI.openFile
                          ? await window.electronAPI.openFile(artifactPath, currentWorkingDir ?? undefined)
                          : false;
                        if (opened) return;
                        const revealed = await window.electronAPI.showItemInFolder(artifactPath, currentWorkingDir ?? undefined);
                        if (!revealed) {
                          setGlobalNotice({
                            id: `artifact-open-failed-${Date.now()}`,
                            type: 'warning',
                            message: t('context.revealFailed'),
                          });
                        }
                      }}
                      title={artifactPath || undefined}
                    >
                      <IconComponent className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="text-xs text-text-primary truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Working Directory */}
      <div className="border-b border-border-muted">
        <div className="px-4 py-2.5">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            {t('context.workingDirectory')}
          </p>
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span
              className={`text-xs truncate flex-1 ${currentWorkingDir ? 'text-text-primary cursor-pointer hover:text-accent-primary transition-colors' : 'text-text-muted'}`}
              title={currentWorkingDir ? t('context.openInFileManager') : ''}
              onClick={() => currentWorkingDir && window.electronAPI?.showItemInFolder(currentWorkingDir)}
            >
              {currentWorkingDir ? formatPath(currentWorkingDir) : t('context.noFolderSelected')}
            </span>
            {currentWorkingDir && (
              <button
                onClick={() => handleCopyPath(currentWorkingDir)}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0 ml-1"
                title={t('context.copyPath')}
              >
                {copiedPath ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
            <button
              onClick={async () => {
                setIsChangingDir(true);
                try {
                  const result = await changeWorkingDir(
                    activeSessionId || undefined,
                    currentWorkingDir || undefined
                  );
                  if (!result.success && result.error && result.error !== 'User cancelled') {
                    setGlobalNotice({
                      id: `change-dir-failed-${Date.now()}`,
                      type: 'warning',
                      message: `${t('context.changeDirFailed')}: ${result.error}`,
                    });
                  }
                } catch (error) {
                  setGlobalNotice({
                    id: `change-dir-failed-${Date.now()}`,
                    type: 'error',
                    message:
                      error instanceof Error && error.message
                        ? `${t('context.changeDirFailed')}: ${error.message}`
                        : t('context.changeDirFailed'),
                  });
                } finally {
                  setIsChangingDir(false);
                }
              }}
              disabled={isChangingDir}
              className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors shrink-0"
              title={t('context.changeDir')}
            >
              {isChangingDir ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FolderSync className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1" />
    </div>
  );
}

// Format long paths to show abbreviated version
function formatPath(path: string): string {
  if (!path) return '';
  
  // Windows: Replace C:\Users\username with ~
  const winHome = /^[A-Z]:\\Users\\[^\\]+/i;
  const winMatch = path.match(winHome);
  if (winMatch) {
    return '~' + path.slice(winMatch[0].length).replace(/\\/g, '/');
  }
  
  // macOS/Linux: Replace /Users/username or /home/username with ~
  const unixHome = /^\/(?:Users|home)\/[^/]+/;
  const unixMatch = path.match(unixHome);
  if (unixMatch) {
    return '~' + path.slice(unixMatch[0].length);
  }
  
  return path;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function todoStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckSquare className="w-3.5 h-3.5 text-success" />;
    case 'in_progress':
      return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 text-text-muted" />;
    default:
      return <Square className="w-3.5 h-3.5 text-text-muted" />;
  }
}

function todoStatusStyle(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-text-muted line-through';
    case 'in_progress':
      return 'text-accent font-medium';
    case 'cancelled':
      return 'text-text-muted line-through opacity-60';
    default:
      return 'text-text-primary';
  }
}

// Icon for a trace step status (the live "process" view).
function traceStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return <CheckSquare className="w-3.5 h-3.5 text-success" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />;
    case 'error':
      return <XCircle className="w-3.5 h-3.5 text-error" />;
    default:
      return <Square className="w-3.5 h-3.5 text-text-muted" />;
  }
}
