import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCreateNote, useNotes } from '../hooks/useNotes';
import { useSelectionStore } from '../store/useSelectionStore';
import type { NoteSummary } from '../api/types';

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

  const heading = activeTag
    ? `#${activeTag}`
    : selectedFolderId
      ? 'Folder'
      : 'All Notes';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-text">{heading}</span>
        <div className="flex items-center gap-1">
          {showSubfolderToggle && (
            <button
              type="button"
              onClick={() => setIncludeSubfolders(!includeSubfolders)}
              title={
                includeSubfolders
                  ? 'Show only the current level'
                  : 'Include all subfolders'
              }
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-accent"
              style={includeSubfolders ? { color: 'var(--accent)' } : undefined}
            >
              {selectedFolderId == null
                ? includeSubfolders
                  ? 'All folders'
                  : 'Root only'
                : includeSubfolders
                  ? 'With subfolders'
                  : 'This folder'}
            </button>
          )}
          <button
            type="button"
            onClick={newNote}
            className="rounded-lg px-3 py-1 text-sm font-medium text-accent-contrast transition hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            + New
          </button>
          {onToggleCollapse && (
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
                />
              ))}
            </SortableContext>
          </ul>
        )}
      </div>
    </div>
  );
}

function NoteItem({
  note,
  selected,
  onSelect,
}: {
  note: NoteSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging, transform, transition } =
    useSortable({
      id: `note:${note.id}`,
      data: { type: 'note', title: note.title || 'Untitled', folderId: note.folderId },
    });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={onSelect}
        className={`w-full border-b border-border px-4 py-3 text-left transition hover:bg-surface-2 ${
          selected ? 'bg-surface-2' : ''
        } ${isDragging ? 'opacity-50' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`truncate text-sm font-medium ${
              selected ? 'text-accent' : 'text-text'
            }`}
          >
            {note.title || 'Untitled'}
          </span>
          {note.sourceModel && (
            <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              {note.sourceModel}
            </span>
          )}
        </div>
        {note.excerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{note.excerpt}</p>
        )}
        {note.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {note.tags.map((t) => (
              <span key={t} className="text-[10px] text-accent">
                #{t}
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
