import { useState } from 'react';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCreateNote, useNotes } from '../hooks/useNotes';
import { useSelectionStore } from '../store/useSelectionStore';
import type { NoteSummary } from '../api/types';
import { ExportModal } from './ExportModal';

export function NoteList({
  onToggleCollapse,
}: {
  onToggleCollapse?: () => void;
}) {
  const selectedFolderId = useSelectionStore((s) => s.selectedFolderId);
  const activeTag = useSelectionStore((s) => s.activeTag);
  const selectedNoteId = useSelectionStore((s) => s.selectedNoteId);
  const selectNote = useSelectionStore((s) => s.selectNote);
  const includeSubfolders = useSelectionStore((s) => s.includeSubfolders);
  const setIncludeSubfolders = useSelectionStore((s) => s.setIncludeSubfolders);
  const exportMode = useSelectionStore((s) => s.exportMode);
  const setExportMode = useSelectionStore((s) => s.setExportMode);
  const checkedNoteIds = useSelectionStore((s) => s.checkedNoteIds);
  const toggleChecked = useSelectionStore((s) => s.toggleChecked);
  const setChecked = useSelectionStore((s) => s.setChecked);

  const [exportOpen, setExportOpen] = useState(false);

  const showSubfolderToggle = !activeTag;

  const { data: notes = [], isLoading } = useNotes({
    folderId: activeTag ? undefined : selectedFolderId,
    tag: activeTag ?? undefined,
    includeSubfolders: showSubfolderToggle && includeSubfolders,
  });
  const createNote = useCreateNote();

  function newNote() {
    createNote.mutate(
      {
        title: 'Untitled',
        contentMarkdown: '',
        folderId: activeTag ? null : selectedFolderId,
        sourceModel: null,
        tags: [],
      },
      { onSuccess: (note) => selectNote(note.id) },
    );
  }

  const checkedSet = new Set(checkedNoteIds);
  // Ordered ids follow the visible list order so the export matches the UI.
  const orderedCheckedIds = notes
    .map((n) => n.id)
    .filter((id) => checkedSet.has(id));
  const allChecked =
    notes.length > 0 && orderedCheckedIds.length === notes.length;

  function toggleSelectAll() {
    setChecked(allChecked ? [] : notes.map((n) => n.id));
  }

  const heading = activeTag
    ? `#${activeTag}`
    : selectedFolderId
      ? 'Folder'
      : 'All Notes';

  let scopeTitle: string;
  if (selectedFolderId == null) {
    scopeTitle = includeSubfolders
      ? 'Showing all folders — click to show root only'
      : 'Showing root only — click to include all folders';
  } else {
    scopeTitle = includeSubfolders
      ? 'Including subfolders — click to show this folder only'
      : 'This folder only — click to include subfolders';
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text">{heading}</span>
        <div className="flex items-center gap-1">
          {showSubfolderToggle && !exportMode && (
            <button
              type="button"
              onClick={() => setIncludeSubfolders(!includeSubfolders)}
              title={scopeTitle}
              aria-pressed={includeSubfolders}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition hover:bg-surface-2 hover:text-accent ${
                includeSubfolders ? 'bg-surface-2 text-accent' : 'text-muted'
              }`}
              style={includeSubfolders ? { color: 'var(--accent)' } : undefined}
            >
              ⤵
            </button>
          )}
          {!exportMode && notes.length > 0 && (
            <button
              type="button"
              onClick={() => setExportMode(true)}
              title="Select notes to export"
              className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-muted transition hover:bg-surface-2 hover:text-accent"
            >
              ⭳
            </button>
          )}
          {!exportMode && (
            <button
              type="button"
              onClick={newNote}
              title="Create a new note"
              className="flex h-7 w-7 items-center justify-center rounded-md text-base font-medium leading-none text-accent-contrast transition hover:opacity-90"
              style={{ background: 'var(--accent)' }}
            >
              +
            </button>
          )}
          {onToggleCollapse && !exportMode && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Hide list"
              className="rounded-md px-1.5 py-1 text-muted transition hover:bg-surface-2 hover:text-accent"
            >
              ◂
            </button>
          )}
        </div>
      </div>

      {exportMode && (
        <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs font-medium text-muted transition hover:text-accent"
          >
            {allChecked ? 'Clear all' : 'Select all'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">
              {orderedCheckedIds.length} selected
            </span>
            <button
              type="button"
              onClick={() => setExportMode(false)}
              className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={orderedCheckedIds.length === 0}
              onClick={() => setExportOpen(true)}
              className="rounded-lg px-3 py-1 text-xs font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              Export
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-4 py-4 text-sm text-muted">Loading…</p>
        ) : notes.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No notes here yet.
            <br />
            Click <span className="text-accent">+ New</span> and paste an answer.
          </div>
        ) : (
          <ul>
            <SortableContext
              items={notes.map((n) => `note:${n.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {notes.map((note) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  selected={selectedNoteId === note.id}
                  onSelect={() => selectNote(note.id)}
                  exportMode={exportMode}
                  checked={checkedSet.has(note.id)}
                  onToggleChecked={() => toggleChecked(note.id)}
                />
              ))}
            </SortableContext>
          </ul>
        )}
      </div>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        noteIds={orderedCheckedIds}
        totalCount={orderedCheckedIds.length}
        defaultTitle={activeTag ? `#${activeTag}` : 'Exported Notes'}
      />
    </div>
  );
}

function NoteItem({
  note,
  selected,
  onSelect,
  exportMode,
  checked,
  onToggleChecked,
}: {
  note: NoteSummary;
  selected: boolean;
  onSelect: () => void;
  exportMode: boolean;
  checked: boolean;
  onToggleChecked: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging, transform, transition } =
    useSortable({
      id: `note:${note.id}`,
      data: { type: 'note', title: note.title || 'Untitled', folderId: note.folderId },
      disabled: exportMode,
    });

  // In export mode the row toggles its checkbox; drag/selection are disabled.
  const rowProps = exportMode
    ? { onClick: onToggleChecked }
    : { ...listeners, ...attributes, onClick: onSelect };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        {...rowProps}
        className={`flex w-full items-start gap-2 border-b border-border px-4 py-3 text-left transition hover:bg-surface-2 ${
          (selected && !exportMode) || (checked && exportMode)
            ? 'bg-surface-2'
            : ''
        } ${isDragging ? 'opacity-50' : ''}`}
      >
        {exportMode && (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            tabIndex={-1}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span
              className={`truncate text-sm font-medium ${
                (selected && !exportMode) || checked
                  ? 'text-accent'
                  : 'text-text'
              }`}
            >
              {note.title || 'Untitled'}
            </span>
            {note.sourceModel && (
              <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
                {note.sourceModel}
              </span>
            )}
          </span>
          {note.excerpt && (
            <span className="mt-1 line-clamp-2 block text-xs text-muted">
              {note.excerpt}
            </span>
          )}
          {note.tags.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {note.tags.map((t) => (
                <span key={t} className="text-[10px] text-accent">
                  #{t}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
