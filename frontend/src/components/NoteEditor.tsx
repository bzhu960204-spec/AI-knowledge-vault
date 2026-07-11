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

/**
 * Milkdown serializes empty paragraphs (blank lines used for spacing) as
 * `<br />` placeholders. Those HTML tags leak into the clipboard and look
 * wrong when pasted elsewhere, so strip them for the copied text. Fenced code
 * blocks and inline code spans are left untouched.
 */
function toCleanMarkdown(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // code fence / inline code — untouched
      return segment
        // a line that is only a <br /> placeholder — drop it
        .replace(/^[ \t]*<br\s*\/?>[ \t]*$/gim, '')
        // any remaining inline <br /> — turn into a real newline
        .replace(/<br\s*\/?>/gi, '\n');
    })
    .join('')
    // collapse the blank lines left behind into a single paragraph break
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const [question, setQuestion] = useState('');
  const [questionOpen, setQuestionOpen] = useState(false);
  const [sourceModel, setSourceModel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);

  // Each editable field is mirrored into a ref so the save payload always
  // reads the LATEST value, avoiding the stale-closure lag that made title,
  // tags and source-model changes persist a keystroke behind (or not at all).
  const titleRef = useRef('');
  const questionRef = useRef('');
  const sourceModelRef = useRef('');
  const tagsRef = useRef<string[]>([]);
  const markdownRef = useRef('');
  // True while an IME (e.g. Chinese pinyin) composition is in progress, so we
  // don't persist intermediate composing text like "biao'ti".
  const composingRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  // Holds the exact payload to persist, bound to the note it belongs to.
  const pendingSave = useRef<{ id: number; body: NoteRequest } | null>(null);

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setQuestion(note.question ?? '');
      setQuestionOpen(!!note.question);
      setSourceModel(note.sourceModel ?? '');
      setTags(note.tags);
      titleRef.current = note.title;
      questionRef.current = note.question ?? '';
      sourceModelRef.current = note.sourceModel ?? '';
      tagsRef.current = note.tags;
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
    // Capture the payload NOW from refs so every field (title, tags, source
    // model, content) reflects its current value and a later switch can't
    // swap in another note's content.
    pendingSave.current = {
      id: note.id,
      body: {
        title: titleRef.current.trim() || 'Untitled',
        question: questionRef.current.trim() || null,
        contentMarkdown: markdownRef.current,
        folderId: note.folderId,
        sourceModel: sourceModelRef.current || null,
        tags: tagsRef.current,
      },
    };
    setStatus('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, 700);
  }, [note, flushSave]);

  // Flush the pending save when switching notes or unmounting, so the
  // note being left is persisted with its own content.
  useEffect(() => {
    return () => {
      flushSave();
    };
  }, [note?.id, flushSave]);

  // Allow leaving fullscreen reading mode with the Escape key.
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFullscreen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  function handleDelete() {
    if (!note) return;
    if (!window.confirm(`Delete "${note.title}"? This cannot be undone.`)) {
      return;
    }
    deleteNote.mutate(note.id, { onSuccess: () => selectNote(null) });
  }

  // Copy the full note as Markdown so formulas, code blocks and tables stay
  // intact when pasted elsewhere. markdownRef always holds the latest content.
  async function handleCopy() {
    const text = toCleanMarkdown(markdownRef.current);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (e.g. non-secure context) — fall back.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading || !note) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div
      className={
        fullscreen
          ? 'fixed inset-0 z-50 flex flex-col bg-bg'
          : 'flex h-full flex-col'
      }
    >
      {/* Header / metadata */}
      <div className="border-b border-border px-8 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              titleRef.current = e.target.value;
              // Skip saving mid-composition; wait for compositionEnd below.
              if (!composingRef.current) scheduleSave();
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false;
              const value = e.currentTarget.value;
              setTitle(value);
              titleRef.current = value;
              scheduleSave();
            }}
            placeholder="Untitled"
            className="flex-1 bg-transparent text-2xl font-semibold text-text outline-none placeholder:text-muted"
          />
          <div className="flex items-center gap-3">
            <SaveIndicator status={status} />
            <button
              type="button"
              onClick={handleCopy}
              title="Copy full note as Markdown"
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-text"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((v) => !v)}
              title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen reading'}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-text"
            >
              {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
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
                sourceModelRef.current = e.target.value;
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
                tagsRef.current = next;
                scheduleSave();
              }}
            />
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8">
        {/* Question bubble leading into the answer */}
        <div className="mt-4">
          {questionOpen ? (
            <div className="relative mb-5 max-w-2xl">
              <div className="rounded-2xl rounded-bl-md border border-border bg-surface-2 px-4 py-3">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                  <ChatIcon />
                  <span>Question</span>
                  <button
                    type="button"
                    onClick={() => setQuestionOpen(false)}
                    title="Collapse"
                    className="ml-auto rounded px-1 text-muted transition hover:text-text"
                  >
                    ×
                  </button>
                </div>
                <textarea
                  value={question}
                  autoFocus={!question}
                  rows={2}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    questionRef.current = e.target.value;
                    if (!composingRef.current) scheduleSave();
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    composingRef.current = false;
                    const value = e.currentTarget.value;
                    setQuestion(value);
                    questionRef.current = value;
                    scheduleSave();
                  }}
                  onBlur={() => {
                    // Collapse back to the hint when left empty.
                    if (!questionRef.current.trim()) setQuestionOpen(false);
                  }}
                  placeholder="What did you ask the AI?"
                  className="w-full resize-y bg-transparent text-sm leading-relaxed text-text outline-none placeholder:text-muted"
                />
              </div>
              {/* Downward tail pointing at the answer */}
              <div className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 border-b border-r border-border bg-surface-2" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setQuestionOpen(true)}
              className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-text"
            >
              <ChatIcon />
              <span>Add the question this answer responds to</span>
            </button>
          )}
        </div>

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

function ChatIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
