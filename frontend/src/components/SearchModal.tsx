import { useEffect, useState } from 'react';
import { useSearchNotes } from '../hooks/useNotes';
import { useSelectionStore } from '../store/useSelectionStore';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const selectNote = useSelectionStore((s) => s.selectNote);
  const { data: results = [], isFetching } = useSearchNotes(debounced);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, content and tags…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-text outline-none placeholder:text-muted"
        />
        <div className="max-h-96 overflow-y-auto">
          {debounced && isFetching && (
            <p className="px-4 py-3 text-sm text-muted">Searching…</p>
          )}
          {debounced && !isFetching && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">No matches.</p>
          )}
          {results.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => {
                selectNote(note.id);
                onClose();
              }}
              className="w-full border-b border-border px-4 py-3 text-left transition hover:bg-surface-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-text">
                  {note.title || 'Untitled'}
                </span>
                {note.sourceModel && (
                  <span className="shrink-0 text-[10px] text-muted">
                    {note.sourceModel}
                  </span>
                )}
              </div>
              {note.excerpt && (
                <p className="mt-1 line-clamp-1 text-xs text-muted">
                  {note.excerpt}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
