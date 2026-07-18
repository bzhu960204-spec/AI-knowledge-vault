import { useCallback, useEffect, useRef, useState } from 'react';
import { RichTextEditor } from './RichTextEditor';
import { TagInput } from './TagInput';
import {
  useDeleteNote,
  useDeleteQuestionImage,
  useNote,
  useTags,
  useUpdateNote,
  useUploadQuestionImage,
} from '../hooks/useNotes';
import type { NoteRequest, QuestionImage } from '../api/types';
import { useSelectionStore } from '../store/useSelectionStore';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** A locally-editable conversation turn. `id` is null until first persisted. */
interface EditableSegment {
  /** Stable client key for React; never changes over the segment's life. */
  key: string;
  id: number | null;
  question: string;
  /** The answer as rich-text HTML produced by the editor. */
  answer: string;
}

/**
 * Turn an answer's rich-text HTML into plain text for the clipboard: drop the
 * tags, keep the visible words, and turn block boundaries into line breaks so
 * the copied conversation stays readable when pasted anywhere.
 */
function htmlToPlainText(html: string): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // TipTap math nodes keep their source in data-latex; surface it as $…$.
  doc.querySelectorAll('[data-latex]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? '';
    const block = el.getAttribute('data-type') === 'block-math';
    el.replaceWith(doc.createTextNode(block ? `$$${latex}$$` : `$${latex}$`));
  });
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Turn an answer's rich-text HTML into Markdown, preserving headings, emphasis,
 * lists, code, links, images, blockquotes, tables and math so the copied text
 * round-trips back through the editor's Markdown paste path.
 */
function htmlToMarkdown(html: string): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;

    // TipTap math nodes keep their source in data-latex.
    if (el.hasAttribute('data-latex')) {
      const latex = el.getAttribute('data-latex') ?? '';
      return el.getAttribute('data-type') === 'block-math'
        ? `$$${latex}$$`
        : `$${latex}$`;
    }

    const kids = Array.from(el.childNodes).map(inline).join('');
    switch (el.tagName) {
      case 'STRONG':
      case 'B':
        return `**${kids}**`;
      case 'EM':
      case 'I':
        return `*${kids}*`;
      case 'S':
      case 'DEL':
        return `~~${kids}~~`;
      case 'CODE':
        return `\`${kids}\``;
      case 'BR':
        return '  \n';
      case 'A': {
        const href = el.getAttribute('href') ?? '';
        return href ? `[${kids}](${href})` : kids;
      }
      case 'IMG': {
        const src = el.getAttribute('src') ?? '';
        const alt = el.getAttribute('alt') ?? '';
        return `![${alt}](${src})`;
      }
      default:
        return kids;
    }
  };

  const tableToMarkdown = (table: HTMLElement): string => {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length === 0) return '';
    const cells = (tr: Element) =>
      Array.from(tr.querySelectorAll('th,td')).map((c) =>
        inline(c as HTMLElement).trim(),
      );
    const header = cells(rows[0]);
    const sep = header.map(() => '---');
    const body = rows.slice(1).map(cells);
    return [header, sep, ...body].map((r) => `| ${r.join(' | ')} |`).join('\n');
  };

  const block = (node: Node, depth = 0): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;

    if (
      el.hasAttribute('data-latex') &&
      el.getAttribute('data-type') === 'block-math'
    ) {
      return `$$${el.getAttribute('data-latex') ?? ''}$$`;
    }

    switch (el.tagName) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return `${'#'.repeat(Number(el.tagName[1]))} ${inline(el)}`;
      case 'P':
        return inline(el);
      case 'BLOCKQUOTE':
        return Array.from(el.children)
          .map((c) => block(c, depth))
          .join('\n\n')
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
      case 'PRE': {
        const code = el.querySelector('code');
        const lang = code?.className.match(/language-(\S+)/)?.[1] ?? '';
        return `\`\`\`${lang}\n${code?.textContent ?? el.textContent ?? ''}\n\`\`\``;
      }
      case 'UL':
      case 'OL':
        return Array.from(el.children)
          .map((li, i) => {
            const marker = el.tagName === 'OL' ? `${i + 1}.` : '-';
            const pad = '  '.repeat(depth);
            const text = Array.from(li.childNodes)
              .filter((n) => !/^(UL|OL)$/.test((n as HTMLElement).tagName ?? ''))
              .map(inline)
              .join('')
              .trim();
            const nested = Array.from(li.children)
              .filter((c) => /^(UL|OL)$/.test(c.tagName))
              .map((c) => '\n' + block(c, depth + 1))
              .join('');
            return `${pad}${marker} ${text}${nested}`;
          })
          .join('\n');
      case 'HR':
        return '---';
      case 'TABLE':
        return tableToMarkdown(el);
      default:
        return inline(el);
    }
  };

  return Array.from(doc.body.childNodes)
    .map((n) => block(n))
    .filter((s) => s.trim() !== '')
    .join('\n\n')
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

export function NoteEditor({ noteId }: Readonly<NoteEditorProps>) {
  const { data: note, isLoading } = useNote(noteId);
  const { data: tagSuggestions = [] } = useTags();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const uploadImage = useUploadQuestionImage();
  const deleteImage = useDeleteQuestionImage();
  const selectNote = useSelectionStore((s) => s.selectNote);

  const [title, setTitle] = useState('');
  const [sourceModel, setSourceModel] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [segs, setSegs] = useState<EditableSegment[]>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [copied, setCopied] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  // Each editable field is mirrored into a ref so the save payload always
  // reads the LATEST value, avoiding the stale-closure lag that made edits
  // persist a keystroke behind (or not at all).
  const titleRef = useRef('');
  const sourceModelRef = useRef('');
  const tagsRef = useRef<string[]>([]);
  const segsRef = useRef<EditableSegment[]>([]);
  const newKeyCounter = useRef(0);
  // True while an IME (e.g. Chinese pinyin) composition is in progress, so we
  // don't persist intermediate composing text.
  const composingRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<{ id: number; body: NoteRequest } | null>(null);

  // Keep state and ref in lock-step so structural edits and the save payload
  // never diverge. The same array/object references are shared between them.
  const applySegs = useCallback((next: EditableSegment[]) => {
    segsRef.current = next;
    setSegs(next);
  }, []);

  // Live images per persisted segment id (uploads/deletes flow through the
  // note query, not local state).
  const imagesBySegment = new Map<number, QuestionImage[]>();
  for (const s of note?.segments ?? []) {
    imagesBySegment.set(s.id, s.images);
  }

  useEffect(() => {
    if (!note) return;
    setTitle(note.title);
    setSourceModel(note.sourceModel ?? '');
    setTags(note.tags);
    titleRef.current = note.title;
    sourceModelRef.current = note.sourceModel ?? '';
    tagsRef.current = note.tags;

    const built: EditableSegment[] = note.segments.map((s) => ({
      key: `s${s.id}`,
      id: s.id,
      question: s.question ?? '',
      answer: s.answerHtml,
    }));
    applySegs(
      built.length > 0
        ? built
        : [{ key: `n${newKeyCounter.current++}`, id: null, question: '', answer: '' }],
    );
    setStatus('idle');
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immediately persist any pending edit (used before switching/leaving a note).
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const payload = pendingSave.current;
    if (!payload) return;
    pendingSave.current = null;
    updateNote.mutate(payload, {
      onSuccess: (saved) => {
        setStatus('saved');
        // Backfill ids for freshly-created segments so the next save updates
        // them instead of creating duplicates. Server returns segments in the
        // same order we sent them, so match by index.
        if (saved.segments.length === segsRef.current.length) {
          const reconciled = segsRef.current.map((s, i) =>
            s.id == null ? { ...s, id: saved.segments[i].id } : s,
          );
          applySegs(reconciled);
        }
      },
      onError: () => {
        // Surface the failure instead of hanging on "Saving…" forever, and keep
        // the payload so the next edit or note switch can retry it.
        setStatus('error');
        pendingSave.current = payload;
      },
    });
  }, [updateNote, applySegs]);

  const buildPayload = useCallback((): { id: number; body: NoteRequest } | null => {
    if (!note) return null;
    return {
      id: note.id,
      body: {
        title: titleRef.current.trim() || 'Untitled',
        folderId: note.folderId,
        sourceModel: sourceModelRef.current || null,
        tags: tagsRef.current,
        segments: segsRef.current.map((s) => ({
          id: s.id,
          question: s.question.trim() || null,
          answerHtml: s.answer,
        })),
      },
    };
  }, [note]);

  const scheduleSave = useCallback(() => {
    const payload = buildPayload();
    if (!payload) return;
    pendingSave.current = payload;
    setStatus('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, 700);
  }, [buildPayload, flushSave]);

  // Persist immediately (e.g. after adding a segment so it gets an id quickly).
  const saveNow = useCallback(() => {
    const payload = buildPayload();
    if (!payload) return;
    pendingSave.current = payload;
    setStatus('saving');
    flushSave();
  }, [buildPayload, flushSave]);

  // Flush the pending save when switching notes or unmounting.
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

  // Copy the whole conversation to the clipboard, either as Markdown (keeps
  // headings, lists, code, math…) or as readable plain text (tags stripped).
  async function handleCopy(format: 'markdown' | 'plain') {
    const render = format === 'markdown' ? htmlToMarkdown : htmlToPlainText;
    const text = segsRef.current
      .map((s) => {
        const q = s.question.trim();
        return (q ? `Q: ${q}\n\n` : '') + render(s.answer);
      })
      .join('\n\n---\n\n')
      .trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
    setCopyMenuOpen(false);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  // --- Per-segment editing --------------------------------------------------

  function setSegmentQuestion(key: string, value: string) {
    applySegs(segsRef.current.map((s) => (s.key === key ? { ...s, question: value } : s)));
  }

  function setSegmentAnswer(key: string, html: string) {
    // Mutate the shared object in place — the editor is uncontrolled, so no state
    // change is needed and question edits will spread the latest answer.
    const seg = segsRef.current.find((s) => s.key === key);
    if (seg) seg.answer = html;
    scheduleSave();
  }

  function addSegment() {
    const next = [
      ...segsRef.current,
      { key: `n${newKeyCounter.current++}`, id: null, question: '', answer: '' },
    ];
    applySegs(next);
    // Persist right away so the new segment gets an id and can accept images.
    saveNow();
  }

  function deleteSegment(key: string) {
    if (segsRef.current.length <= 1) return; // a note keeps at least one segment
    applySegs(segsRef.current.filter((s) => s.key !== key));
    scheduleSave();
  }

  function moveSegment(key: string, dir: -1 | 1) {
    const arr = [...segsRef.current];
    const i = arr.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    applySegs(arr);
    scheduleSave();
  }

  function uploadForSegment(seg: EditableSegment, files: File[]) {
    if (!note) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    if (seg.id == null) {
      // Not persisted yet — save first so we have a segment id, then retry.
      saveNow();
      return;
    }
    for (const file of images) {
      uploadImage.mutate({ noteId: note.id, segmentId: seg.id, file });
    }
  }

  function removeImage(seg: EditableSegment, imageId: number) {
    if (!note || seg.id == null) return;
    deleteImage.mutate({ noteId: note.id, segmentId: seg.id, imageId });
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
            <div className="relative">
              <button
                type="button"
                onClick={() => setCopyMenuOpen((v) => !v)}
                title="Copy full note"
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:border-accent hover:text-text"
              >
                {copied ? 'Copied' : 'Copy ▾'}
              </button>
              {copyMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close copy menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setCopyMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-bg shadow-lg">
                    <button
                      type="button"
                      onClick={() => handleCopy('plain')}
                      className="block w-full px-3 py-2 text-left text-sm text-muted transition hover:bg-border/40 hover:text-text"
                    >
                      Copy as plain text
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('markdown')}
                      className="block w-full px-3 py-2 text-left text-sm text-muted transition hover:bg-border/40 hover:text-text"
                    >
                      Copy as Markdown
                    </button>
                  </div>
                </>
              )}
            </div>
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

      {/* Conversation */}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
        {segs.map((seg, i) => (
          <SegmentBlock
            key={seg.key}
            segment={seg}
            index={i}
            total={segs.length}
            images={seg.id != null ? imagesBySegment.get(seg.id) ?? [] : []}
            composingRef={composingRef}
            onQuestionChange={(v) => setSegmentQuestion(seg.key, v)}
            onAnswerChange={(md) => setSegmentAnswer(seg.key, md)}
            onScheduleSave={scheduleSave}
            onDelete={() => deleteSegment(seg.key)}
            onMoveUp={() => moveSegment(seg.key, -1)}
            onMoveDown={() => moveSegment(seg.key, 1)}
            onUploadFiles={(files) => uploadForSegment(seg, files)}
            onDeleteImage={(imageId) => removeImage(seg, imageId)}
            onPreview={setPreview}
          />
        ))}

        <button
          type="button"
          onClick={addSegment}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm text-muted transition hover:border-accent hover:text-text"
        >
          <ChatIcon />
          <span>Add a question</span>
        </button>
      </div>

      {preview && (
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8"
        >
          <img
            src={preview}
            alt="attachment"
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </div>
  );
}

interface SegmentBlockProps {
  segment: EditableSegment;
  index: number;
  total: number;
  images: QuestionImage[];
  composingRef: React.RefObject<boolean>;
  onQuestionChange: (value: string) => void;
  onAnswerChange: (md: string) => void;
  onScheduleSave: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUploadFiles: (files: File[]) => void;
  onDeleteImage: (imageId: number) => void;
  onPreview: (url: string) => void;
}

function SegmentBlock({
  segment,
  index,
  total,
  images,
  composingRef,
  onQuestionChange,
  onAnswerChange,
  onScheduleSave,
  onDelete,
  onMoveUp,
  onMoveDown,
  onUploadFiles,
  onDeleteImage,
  onPreview,
}: Readonly<SegmentBlockProps>) {
  const questionTaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const autoSizeQuestion = useCallback(() => {
    const ta = questionTaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useEffect(() => {
    autoSizeQuestion();
  }, [segment.question, autoSizeQuestion]);

  function handleQuestionPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f != null);
    if (files.length > 0) {
      e.preventDefault();
      onUploadFiles(files);
    }
  }

  function handleImageDrop(e: React.DragEvent) {
    const files = Array.from(e.dataTransfer.files);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      onUploadFiles(files);
    }
  }

  return (
    <div className="mb-6">
      {/* Question bubble */}
      <div
        className="relative mb-4 max-w-2xl"
        onDrop={handleImageDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="rounded-2xl rounded-bl-md border border-border bg-surface-2 px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <ChatIcon />
            <span>Question {index + 1}</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                title="Add image"
                className="rounded px-1 text-muted transition hover:text-text"
              >
                <ImageIcon />
              </button>
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                title="Move up"
                className="rounded px-1 text-muted transition hover:text-text disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === total - 1}
                title="Move down"
                className="rounded px-1 text-muted transition hover:text-text disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={total <= 1}
                title="Delete this turn"
                className="rounded px-1 text-muted transition hover:text-red-500 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          </div>
          <textarea
            ref={questionTaRef}
            value={segment.question}
            rows={1}
            onChange={(e) => {
              onQuestionChange(e.target.value);
              autoSizeQuestion();
              if (!composingRef.current) onScheduleSave();
            }}
            onPaste={handleQuestionPaste}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              composingRef.current = false;
              onQuestionChange(e.currentTarget.value);
              autoSizeQuestion();
              onScheduleSave();
            }}
            placeholder="What did you ask the AI? (paste or drop screenshots too)"
            className="w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-text outline-none placeholder:text-muted"
          />
          {images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border"
                >
                  <button
                    type="button"
                    onClick={() => onPreview(img.url)}
                    title="Preview"
                    className="block h-full w-full cursor-zoom-in"
                  >
                    <img
                      src={img.url}
                      alt={img.originalName ?? 'screenshot'}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteImage(img.id)}
                    title="Remove image"
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onUploadFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
        {/* Downward tail pointing at the answer */}
        <div className="absolute -bottom-1.5 left-6 h-3 w-3 rotate-45 border-b border-r border-border bg-surface-2" />
      </div>

      {/* Answer */}
      <RichTextEditor
        key={segment.key}
        value={segment.answer}
        onChange={onAnswerChange}
      />
    </div>
  );
}

function SaveIndicator({ status }: Readonly<{ status: SaveStatus }>) {
  const map: Record<SaveStatus, string> = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed — retrying on next edit',
  };
  if (!map[status]) return null;
  const className =
    status === 'error' ? 'text-xs text-red-500' : 'text-xs text-muted';
  return <span className={className}>{map[status]}</span>;
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

function ImageIcon() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
