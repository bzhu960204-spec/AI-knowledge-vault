import { useEffect, useRef, useState } from 'react';
import { useImportArchive } from '../hooks/useNotes';
import type { ImportResult } from '../api/types';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  /** Folder the bundle is imported into; null means root. */
  targetFolderId: number | null;
  onImported?: (result: ImportResult) => void;
}

/** Upper bound mirrored from the backend so oversized files fail fast. */
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isBundle(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith('.aivault') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'
  );
}

export function ImportModal({
  open,
  onClose,
  targetFolderId,
  onImported,
}: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importArchive = useImportArchive();

  // Reset transient state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setFile(null);
      setDragActive(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  function acceptFile(candidate: File | undefined | null) {
    if (!candidate) return;
    if (!isBundle(candidate)) {
      setError('Please choose a .aivault bundle.');
      return;
    }
    if (candidate.size > MAX_BUNDLE_BYTES) {
      setError('That file is too large to import.');
      return;
    }
    setError(null);
    setResult(null);
    setFile(candidate);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    acceptFile(e.dataTransfer.files?.[0]);
  }

  function handleImport() {
    if (!file) return;
    setError(null);
    importArchive.mutate(
      { file, folderId: targetFolderId },
      {
        onSuccess: (r) => {
          setResult(r);
          onImported?.(r);
        },
        onError: (err) =>
          setError(err instanceof Error ? err.message : 'Import failed.'),
      },
    );
  }

  const busy = importArchive.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text">Import bundle</h2>
          <p className="mt-0.5 text-xs text-muted">
            Content is added as new copies in the current folder.
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
              dragActive
                ? 'border-accent bg-surface-2'
                : 'border-border hover:bg-surface-2'
            }`}
            style={dragActive ? { borderColor: 'var(--accent)' } : undefined}
          >
            {file ? (
              <>
                <span className="text-sm font-medium text-text">
                  {file.name}
                </span>
                <span className="text-xs text-muted">
                  {formatSize(file.size)}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setResult(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      setFile(null);
                      setResult(null);
                    }
                  }}
                  className="mt-1 text-xs text-muted underline transition hover:text-accent"
                >
                  Choose a different file
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl text-muted">⭱</span>
                <span className="text-sm text-text">
                  Drag a{' '}
                  <span className="font-medium text-accent">.aivault</span> file
                  here
                </span>
                <span className="text-xs text-muted">or click to browse</span>
              </>
            )}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".aivault,application/zip"
            onChange={(e) => {
              acceptFile(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />

          {error && <p className="text-xs text-red-500">{error}</p>}
          {result && (
            <p className="text-xs text-emerald-600">
              Imported {result.notes} note{result.notes === 1 ? '' : 's'} and{' '}
              {result.folders} folder{result.folders === 1 ? '' : 's'}.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-surface-2"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!file || busy}
              className="rounded-lg px-4 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
