import { useEffect, useState } from 'react';
import { notesApi } from '../api/endpoints';
import type { ExportFormat } from '../api/types';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  /** Ordered note ids to export. Empty means "whole folder". */
  noteIds: number[];
  folderId?: number | null;
  includeSubfolders?: boolean;
  /** Human-readable count shown in the dialog header. */
  totalCount: number;
  defaultTitle?: string;
}

function triggerHtmlDownload(html: string, filename: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function triggerPrint(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 1000);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    cleanup();
  };
  // Wait until KaTeX has finished (or timed out) so formulas are laid out.
  const waitForMath = (attempts = 0) => {
    const ready =
      (iframe.contentWindow as unknown as { __mathReady?: boolean })
        ?.__mathReady === true;
    if (ready || attempts > 100) {
      window.setTimeout(doPrint, 100);
    } else {
      window.setTimeout(() => waitForMath(attempts + 1), 50);
    }
  };
  waitForMath();
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim() || 'export';
  return trimmed.replace(/[\\/:*?"<>|]/g, '_');
}

export function ExportModal({
  open,
  onClose,
  noteIds,
  folderId,
  includeSubfolders,
  totalCount,
  defaultTitle,
}: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('PDF');
  const [includeQuestion, setIncludeQuestion] = useState(true);
  const [title, setTitle] = useState(defaultTitle ?? 'Exported Notes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh the default title each time the dialog opens so it reflects the
  // currently selected notes. Users can still edit it before exporting.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle ?? 'Exported Notes');
    }
  }, [open, defaultTitle]);

  if (!open) return null;

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const html = await notesApi.exportHtml({
        noteIds,
        folderId: noteIds.length === 0 ? (folderId ?? null) : undefined,
        includeSubfolders: noteIds.length === 0 ? includeSubfolders : undefined,
        includeQuestion,
        title,
      });
      if (format === 'HTML') {
        triggerHtmlDownload(html, `${sanitizeFilename(title)}.html`);
      } else {
        triggerPrint(html);
      }
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Export failed, please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text">Export notes</h2>
          <p className="mt-0.5 text-xs text-muted">
            {totalCount} note{totalCount === 1 ? '' : 's'} · concatenated in
            order
          </p>
        </div>

        <div className="space-y-5 px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              Document title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
          </label>

          <div>
            <span className="mb-2 block text-xs font-medium text-muted">
              Format
            </span>
            <div className="flex gap-2">
              {(['PDF', 'HTML'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    format === f
                      ? 'border-transparent text-accent-contrast'
                      : 'border-border text-muted hover:bg-surface-2'
                  }`}
                  style={
                    format === f ? { background: 'var(--accent)' } : undefined
                  }
                >
                  {f}
                </button>
              ))}
            </div>
            {format === 'PDF' && (
              <p className="mt-1.5 text-[11px] text-muted">
                Opens the print dialog — choose “Save as PDF”.
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeQuestion}
              onChange={(e) => setIncludeQuestion(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-sm text-text">Include the question</span>
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={busy || totalCount === 0}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
