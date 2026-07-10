import { useCallback, useEffect, useRef, useState } from 'react';
import { MilkdownEditor } from './MilkdownEditor';
import { TagInput } from './TagInput';
import {
  useDeleteNote,
  useNote,
  useTags,
  useUpdateNote,
} from '../hooks/useNotes';
import type { NoteRequest } from '../api/types';
import { useSelectionStore } from '../store/useSelectionStore';

type SaveStatus = 'idle' | 'saving' | 'saved';

const MODEL_OPTIONS = [
  'GPT-4',
  'GPT-4o',
  'Claude',
  'Gemini',
  'DeepSeek',
  'Llama',
  'Other',
];

interface NoteEditorProps {
  noteId: number;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const { data: note, isLoading } = useNote(noteId);
  const { data: tagSuggestions = [] } = useTags();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const selectNote = useSelectionStore((s) => s.selectNote);

  const [title, setTitle] = useState('');
  const [sourceModel, setSourceModel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const markdownRef = useRef('');
  const saveTimer = useRef<number | undefined>(undefined);
  // Holds the exact payload to persist, bound to the note it belongs to.
  const pendingSave = useRef<{ id: number; body: NoteRequest } | null>(null);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setSourceModel(note.sourceModel ?? '');
      setTags(note.tags);
      markdownRef.current = note.contentMarkdown;
      setStatus('idle');
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immediately persist any pending edit (used before switching/leaving a note).
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const payload = pendingSave.current;
    if (!payload) return;
    pendingSave.current = null;
    updateNote.mutate(payload, { onSuccess: () => setStatus('saved') });
  }, [updateNote]);

  const scheduleSave = useCallback(() => {
    if (!note) return;
    // Capture the payload NOW so a later switch can't swap in another
    // note's content via the shared markdown ref.
    pendingSave.current = {
      id: note.id,
      body: {
        title: title.trim() || 'Untitled',
        contentMarkdown: markdownRef.current,
        folderId: note.folderId,
        sourceModel: sourceModel || null,
        tags,
      },
    };
    setStatus('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, 700);
  }, [note, title, sourceModel, tags, flushSave]);

  // Flush the pending save when switching notes or unmounting, so the
  // note being left is persisted with its own content.
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [note?.id, flushSave]);

  function handleDelete() {
    if (!note) return;
    if (!window.confirm(`Delete "${note.title}"? This cannot be undone.`)) {
      return;
    }
    deleteNote.mutate(note.id, { onSuccess: () => selectNote(null) });
  }

  if (isLoading || !note) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header / metadata */}
      <div className="border-b border-border px-8 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave();
            }}
            placeholder="Untitled"
            className="flex-1 bg-transparent text-2xl font-semibold text-text outline-none placeholder:text-muted"
          />
          <div className="flex items-center gap-3">
            <SaveIndicator status={status} />
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-red-400 hover:text-red-500"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted">
            Source
            <select
              value={sourceModel}
              onChange={(e) => {
                setSourceModel(e.target.value);
                scheduleSave();
              }}
              className="rounded-lg border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
            >
              <option value="">— none —</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <div className="min-w-64 flex-1">
            <TagInput
              tags={tags}
              suggestions={tagSuggestions}
              onChange={(next) => {
                setTags(next);
                scheduleSave();
              }}
            />
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        <MilkdownEditor
          key={note.id}
          value={note.contentMarkdown}
          onChange={(md) => {
            markdownRef.current = md;
            scheduleSave();
          }}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
  };
  if (!map[status]) return null;
  return <span className="text-xs text-muted">{map[status]}</span>;
}
