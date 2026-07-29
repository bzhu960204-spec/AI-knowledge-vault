import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useSearchNotes, useTags } from '../hooks/useNotes';
import { useFolders } from '../hooks/useFolders';
import { useSelectionStore } from '../store/useSelectionStore';
import { buildFolderTree } from '../utils/tree';
import type { Folder, FolderNode, SearchField, SearchResult, SearchSort } from '../api/types';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

const FIELDS: { value: SearchField; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'title', label: 'Title' },
  { value: 'question', label: 'Question' },
  { value: 'answer', label: 'Answer' },
];

const SORTS: { value: SearchSort; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'updated', label: 'Recent' },
];

const FIELD_BADGE: Record<string, string> = {
  title: 'Title',
  tag: 'Tag',
  question: 'Question',
  answer: 'Answer',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split text and wrap any occurrence of the query terms in a highlight mark. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text) return null;
  const valid = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (valid.length === 0) return <>{text}</>;
  const splitter = new RegExp(`(${valid.join('|')})`, 'gi');
  const matcher = new RegExp(`^(${valid.join('|')})$`, 'i');
  const parts = text.split(splitter);
  return (
    <>
      {parts.map((part, i) =>
        matcher.test(part) ? (
          <mark
            key={i}
            className="rounded px-0.5 text-text"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
            }}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [field, setField] = useState<SearchField>('all');
  const [sort, setSort] = useState<SearchSort>('relevance');
  const [folderId, setFolderId] = useState<number | null>(null);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const revealNote = useSelectionStore((s) => s.revealNote);
  const { data: folders = [] } = useFolders();
  const { data: tags = [] } = useTags();

  const { data: results = [], isFetching } = useSearchNotes({
    q: debounced,
    folderId,
    includeSubfolders,
    tag: activeTag,
    field,
    sort,
  });

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveTag(null);
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  function openResult(note: SearchResult) {
    revealNote(note.id, note.folderId);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const note = results[activeIndex];
      if (note) openResult(note);
    }
  }

  const hasQuery = debounced.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-20"
      onClick={onClose}
    >
      <div
        className="flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, questions, answers and tags…"
            className="w-full bg-transparent py-3 text-text outline-none placeholder:text-muted"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
          <Segmented
            options={FIELDS}
            value={field}
            onChange={(v) => setField(v as SearchField)}
          />
          <span className="text-border">|</span>
          <Segmented
            options={SORTS}
            value={sort}
            onChange={(v) => setSort(v as SearchSort)}
          />
          <span className="text-border">|</span>
          <FolderFilter
            folders={folders}
            value={folderId}
            includeSubfolders={includeSubfolders}
            onChange={setFolderId}
            onIncludeSubfoldersChange={setIncludeSubfolders}
          />
        </div>

        {/* Tag chips */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
            {tags.map((tag) => {
              const on = activeTag === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setActiveTag(on ? null : tag)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                    on
                      ? 'border-transparent text-white'
                      : 'border-border text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                  style={on ? { backgroundColor: 'var(--accent)' } : undefined}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}

        {/* Result count */}
        {hasQuery && (
          <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-muted">
            <span>
              {isFetching
                ? 'Searching…'
                : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
            </span>
            <span className="hidden sm:inline">↑↓ navigate · Enter open · Esc close</span>
          </div>
        )}

        {/* Results */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {!hasQuery && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              <p className="mb-2 text-text">Search your knowledge vault</p>
              <p>Type keywords — every word must match.</p>
              <p>
                Use <code className="rounded bg-surface-2 px-1">"quotes"</code> for an
                exact phrase, and the filters above to narrow by folder, tag or field.
              </p>
            </div>
          )}

          {hasQuery && !isFetching && results.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              <p className="mb-1 text-text">No matches</p>
              <p>Try fewer words or clear a filter.</p>
            </div>
          )}

          {results.map((note, index) => (
            <button
              key={note.id}
              type="button"
              data-index={index}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openResult(note)}
              className={`block w-full border-b border-border px-4 py-3 text-left transition ${
                index === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                  <Highlight text={note.title || 'Untitled'} terms={note.terms} />
                </span>
                {note.matchFields.map((f) => (
                  <span
                    key={f}
                    className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-border"
                  >
                    {FIELD_BADGE[f] ?? f}
                  </span>
                ))}
                {note.matchSegment != null && (
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-border">
                    Q#{note.matchSegment}
                  </span>
                )}
              </div>

              {note.snippet && (
                <p className="mt-1 line-clamp-2 text-xs text-muted">
                  <Highlight text={note.snippet} terms={note.terms} />
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted">
                {note.folderPath ? (
                  <span className="truncate">📁 {note.folderPath}</span>
                ) : (
                  <span>📁 Root</span>
                )}
                {note.tags.map((tag) => (
                  <span key={tag} style={{ color: 'var(--accent)' }}>
                    #{tag}
                  </span>
                ))}
                {note.sourceModel && <span>· {note.sourceModel}</span>}
                <span>· {formatDate(note.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** id -> full "A / B / C" path, so search can match on the whole path. */
function buildPathMap(folders: Folder[]): Map<number, string> {
  const byId = new Map<number, Folder>(folders.map((f) => [f.id, f]));
  const cache = new Map<number, string>();
  const resolve = (folder: Folder): string => {
    const parts: string[] = [];
    let current: Folder | undefined = folder;
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.name);
      current = current.parentId == null ? undefined : byId.get(current.parentId);
    }
    return parts.join(' / ');
  };
  folders.forEach((f) => cache.set(f.id, resolve(f)));
  return cache;
}

interface FlatFolder {
  id: number;
  name: string;
  depth: number;
}

/** Depth-first flatten of the folder tree, carrying indentation depth. */
function flattenTree(nodes: FolderNode[], depth = 0, out: FlatFolder[] = []): FlatFolder[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) flattenTree(node.children, depth + 1, out);
  }
  return out;
}

interface FolderRow {
  id: number | null;
  label: string;
  depth: number;
  isCurrent?: boolean;
}

/**
 * A searchable folder scope picker. Shows the folder hierarchy (indented) when
 * idle and a flat, path-labelled match list while filtering, so a big vault no
 * longer means one very long dropdown. The "include subfolders" toggle lives in
 * the same popover.
 */
function FolderFilter({
  folders,
  value,
  includeSubfolders,
  onChange,
  onIncludeSubfoldersChange,
}: {
  folders: Folder[];
  value: number | null;
  includeSubfolders: boolean;
  onChange: (id: number | null) => void;
  onIncludeSubfoldersChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const currentFolderId = useSelectionStore((s) => s.selectedFolderId);

  const paths = useMemo(() => buildPathMap(folders), [folders]);
  const hierarchy = useMemo(() => flattenTree(buildFolderTree(folders)), [folders]);
  const query = q.trim().toLowerCase();

  const rows: FolderRow[] = useMemo(() => {
    const list: FolderRow[] = [{ id: null, label: 'All folders', depth: 0 }];
    if (!query && currentFolderId != null && paths.has(currentFolderId)) {
      list.push({
        id: currentFolderId,
        label: paths.get(currentFolderId)!,
        depth: 0,
        isCurrent: true,
      });
    }
    if (query) {
      folders
        .map((f) => ({ id: f.id, path: paths.get(f.id) ?? f.name }))
        .filter((f) => f.path.toLowerCase().includes(query))
        .sort((a, b) => a.path.localeCompare(b.path))
        .forEach((f) => list.push({ id: f.id, label: f.path, depth: 0 }));
    } else {
      hierarchy.forEach((h) => list.push({ id: h.id, label: h.name, depth: h.depth }));
    }
    return list;
  }, [folders, paths, hierarchy, query, currentFolderId]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q, open]);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const buttonLabel = value == null ? 'All folders' : paths.get(value) ?? 'Folder';

  function choose(row: FolderRow) {
    onChange(row.id);
    setOpen(false);
    setQ('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const row = rows[activeIndex];
      if (row) choose(row);
    }
  }

  const noMatches = query.length > 0 && rows.length === 1;

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 288;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      setPos({ top: rect.bottom + 4, left, width });
    }
    setOpen(true);
  }

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-text transition hover:border-accent"
      >
        <span className="max-w-[160px] truncate">{buttonLabel}</span>
        {value != null && includeSubfolders && (
          <span className="text-[10px] text-muted">+sub</span>
        )}
        <span className="text-muted">▾</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
              className="z-[61] overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
              onKeyDown={onKeyDown}
            >
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter folders…"
                className="w-full border-b border-border bg-transparent px-3 py-2 text-sm text-text outline-none placeholder:text-muted"
              />
              <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
                {noMatches && (
                  <p className="px-3 py-2 text-xs text-muted">No folders match</p>
                )}
                {rows.map((row, index) => {
                  const selected = row.id === value;
                  const active = index === activeIndex;
                  return (
                    <button
                      key={`${row.id ?? 'all'}-${index}`}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(row)}
                      className={`flex w-full items-center gap-1.5 py-1.5 pr-3 text-left text-sm transition ${
                        active ? 'bg-surface-2' : ''
                      }`}
                      style={{
                        paddingLeft: `${12 + row.depth * 14}px`,
                        ...(selected ? { color: 'var(--accent)' } : {}),
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {query ? <Highlight text={row.label} terms={[query]} /> : row.label}
                      </span>
                      {row.isCurrent && (
                        <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-muted ring-1 ring-border">
                          current
                        </span>
                      )}
                      {selected && (
                        <span className="shrink-0" style={{ color: 'var(--accent)' }}>
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {value != null && (
                <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    onChange={(e) => onIncludeSubfoldersChange(e.target.checked)}
                  />
                  Include subfolders
                </label>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2 py-1 transition ${
              on ? 'text-white' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
            style={on ? { backgroundColor: 'var(--accent)' } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
