import { useState, useEffect } from 'react';

export interface McpConnector {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
}

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

/**
 * Poll the list of MCP servers that are currently connected and expose tools.
 * Shared by the welcome composer and the chat header so both can offer a
 * per-chat MCP enable/disable picker.
 */
export function useMcpConnectors(active = true): McpConnector[] {
  const [connectors, setConnectors] = useState<McpConnector[]>([]);

  useEffect(() => {
    if (!isElectron || !active) return;
    let cancelled = false;

    const load = async () => {
      try {
        const statuses = (await window.electronAPI.mcp.getServerStatus()) as McpConnector[];
        const list = (statuses || []).filter((s) => s.connected && s.toolCount > 0);
        if (!cancelled) setConnectors(list);
      } catch {
        // best-effort; keep the previous list on transient errors
      }
    };

    void load();
    const interval = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active]);

  return connectors;
}
