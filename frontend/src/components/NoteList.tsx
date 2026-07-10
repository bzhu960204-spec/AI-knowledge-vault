import { useCreateNote, useNotes } from '../hooks/useNotes';
import { useSelectionStore } from '../store/useSelectionStore';

export function NoteList() {
  const selectedFolderId = useSelectionStore((s) => s.selectedFolderId);
  const activeTag = useSelectionStore((s) => s.activeTag);
  const selectedNoteId = useSelectionStore((s) => s.selectedNoteId);
  const selectNote = useSelectionStore((s) => s.selectNote);

  const { data: notes = [], isLoading } = useNotes({
    folderId: activeTag ? undefined : selectedFolderId,
    tag: activeTag ?? undefined,
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
        <button
          type="button"
          onClick={newNote}
          className="rounded-lg px-3 py-1 text-sm font-medium text-accent-contrast transition hover:opacity-90"
          style={{ background: 'var(--accent)' }}
        >
          + New
        </button>
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
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => selectNote(note.id)}
                  className={`w-full border-b border-border px-4 py-3 text-left transition hover:bg-surface-2 ${
                    selectedNoteId === note.id ? 'bg-surface-2' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm font-medium ${
                        selectedNoteId === note.id ? 'text-accent' : 'text-text'
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
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {note.excerpt}
                    </p>
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
