import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2 } from 'lucide-react';

/**
 * A live, auto-scrolling code view shown while a content-writing tool (e.g. the
 * `write` tool) is streaming. Renders the tail of the generated content so the
 * user watches the file (HTML, etc.) "type out" in real time, Claude-style.
 */
const MAX_TAIL_CHARS = 4000;

export function StreamingCodePreview({ content, path }: { content: string; path?: string }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLPreElement>(null);

  const fileName = useMemo(() => {
    if (!path) return undefined;
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }, [path]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);

  // Only render the tail to keep updates cheap on large files.
  const { tail, truncated } = useMemo(() => {
    if (content.length <= MAX_TAIL_CHARS) return { tail: content, truncated: false };
    return { tail: content.slice(content.length - MAX_TAIL_CHARS), truncated: true };
  }, [content]);

  // Keep the latest line in view as content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  return (
    <div className="mt-2 max-w-[680px] rounded-lg border border-border-subtle bg-surface-muted/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-surface-muted">
        <FileCode2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-xs font-medium text-text-secondary truncate">
          {fileName
            ? t('chat.writingFile', { name: fileName })
            : t('chat.generatingCode')}
        </span>
        <span className="ml-auto text-[11px] text-text-muted flex-shrink-0">
          {t('chat.linesCount', { count: lineCount })}
        </span>
      </div>
      <pre
        ref={scrollRef}
        className="text-[11px] leading-relaxed font-mono text-text-secondary whitespace-pre-wrap break-all px-3 py-2 max-h-[200px] overflow-y-auto"
      >
        {truncated ? `… ${tail}` : tail}
        <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-accent/70 animate-pulse" />
      </pre>
    </div>
  );
}
