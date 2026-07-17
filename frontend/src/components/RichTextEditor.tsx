import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { Mathematics, migrateMathStrings } from '@tiptap/extension-mathematics';
import 'katex/dist/katex.min.css';
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Sigma,
} from 'lucide-react';

// ── Resizable image node ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ResizableImageView({ node, updateAttributes, editor }: any) {
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef({ startX: 0, startW: 0 });

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drag.current.startX = e.clientX;
      drag.current.startW = imgRef.current?.offsetWidth ?? (node.attrs.width ?? 300);

      const onMove = (mv: MouseEvent) => {
        const newW = Math.max(50, Math.round(drag.current.startW + mv.clientX - drag.current.startX));
        updateAttributes({ width: newW });
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [updateAttributes, node.attrs.width],
  );

  const isEditable: boolean = editor?.isEditable ?? false;
  const w: number | null = node.attrs.width ?? null;

  return (
    <NodeViewWrapper as="div" className="doc-img-wrap" contentEditable={false}>
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        style={w ? { width: `${w}px`, maxWidth: '100%' } : { maxWidth: '100%' }}
      />
      {isEditable && <span className="doc-img-resize-handle" onMouseDown={onResizeMouseDown} />}
    </NodeViewWrapper>
  );
}

// ── Plain-text math parsing (for paste) ──────────────────────────────────────
// The Mathematics extension's `migrateMathStrings` only understands single-`$`
// inline math on a single text node, so pasted `$$…$$` block math (or multi-line
// formulas) never render. We parse the pasted plain text ourselves and build
// proper `blockMath` / `inlineMath` nodes.

type MathJSON = { type: string; attrs?: Record<string, string>; text?: string; content?: MathJSON[] };

// Inline `$…$` (no newline inside; not `$100$` currency).
const INLINE_MATH_RE = /\$(?!\d+\$)([^\n]+?)\$(?!\d)/g;
// Block `$$…$$` (may span multiple lines).
const BLOCK_MATH_RE = /\$\$([\s\S]+?)\$\$/g;

function hasMathDelimiters(text: string): boolean {
  return /\$\$[\s\S]+?\$\$/.test(text) || /\$(?!\d+\$)[^\n]+?\$(?!\d)/.test(text);
}

/** Split a single line of text into text + inlineMath nodes. */
function inlineContent(line: string): MathJSON[] {
  const nodes: MathJSON[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_MATH_RE.lastIndex = 0;
  while ((m = INLINE_MATH_RE.exec(line))) {
    if (m.index > last) nodes.push({ type: 'text', text: line.slice(last, m.index) });
    nodes.push({ type: 'inlineMath', attrs: { latex: m[1].trim() } });
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) });
  return nodes;
}

/** Turn a run of non-block-math text into paragraph nodes (one per line). */
function textToParagraphs(text: string): MathJSON[] {
  const blocks: MathJSON[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const content = inlineContent(line);
    if (content.length) blocks.push({ type: 'paragraph', content });
  }
  return blocks;
}

/** Parse pasted plain text into a list of block nodes, converting math. */
function parsePastedMath(text: string): MathJSON[] {
  const blocks: MathJSON[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BLOCK_MATH_RE.lastIndex = 0;
  while ((m = BLOCK_MATH_RE.exec(text))) {
    blocks.push(
      ...textToParagraphs(text.slice(last, m.index)),
      { type: 'blockMath', attrs: { latex: m[1].trim() } },
    );
    last = m.index + m[0].length;
  }
  blocks.push(...textToParagraphs(text.slice(last)));
  return blocks;
}

/**
 * Convert LaTeX in already-loaded content into math nodes.
 *
 * The extension's own `migrateMathStrings` only understands single-`$` inline
 * math on one text node, so legacy notes that stored a literal `$$…$$` block
 * (even embedded mid-paragraph) render as a broken red error. Here we first
 * rebuild any textblock containing `$$…$$` into `blockMath` + paragraph nodes,
 * then fall back to the built-in inline migration for the rest (which preserves
 * surrounding marks).
 */
function migrateMath(editor: Editor) {
  const { schema } = editor;
  if (schema.nodes.blockMath) {
    const tr = editor.state.tr;
    const jobs: { from: number; to: number; nodes: PMNode[] }[] = [];
    editor.state.doc.forEach((node, offset) => {
      if (!node.isTextblock) return;
      if (!/\$\$[\s\S]+?\$\$/.test(node.textContent)) return;
      const nodes = parsePastedMath(node.textContent).map((j) => schema.nodeFromJSON(j));
      jobs.push({ from: offset, to: offset + node.nodeSize, nodes });
    });
    // Apply last-to-first so earlier positions stay valid.
    for (let i = jobs.length - 1; i >= 0; i--) {
      tr.replaceWith(jobs[i].from, jobs[i].to, jobs[i].nodes);
    }
    if (jobs.length) {
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    }
  }
  // Inline `$…$` for the remaining text (preserves surrounding marks).
  migrateMathStrings(editor);
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('width') || el.style.width;
          if (!raw) return null;
          const n = parseInt(raw, 10);
          return isNaN(n) ? null : n;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        renderHTML: (attrs: Record<string, any>) => {
          if (!attrs.width) return {};
          return { width: String(attrs.width), style: `width:${attrs.width}px` };
        },
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

interface RichTextEditorProps {
  /** Initial HTML value. The editor is uncontrolled after mount. */
  value: string;
  onChange: (html: string) => void;
}

/**
 * TipTap-based rich-text editor storing HTML.
 *
 * Unlike a Markdown editor, pasting keeps the clipboard's HTML intact, so links
 * and formatting survive verbatim. LaTeX written as `$…$` / `$$…$$` is turned
 * into interactive math nodes via the Mathematics extension (and legacy notes
 * are converted on load with `migrateMathStrings`).
 *
 * The editor is uncontrolled: remount it with a `key` to load new content.
 */
export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Paste or write the AI's answer…" }),
      Link.configure({ openOnClick: false }),
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false, HTMLAttributes: { class: 'doc-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt('Edit formula (LaTeX):', node.attrs.latex);
            if (latex != null) {
              editor?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();
            }
          },
        },
        blockOptions: {
          onClick: (node, pos) => {
            const latex = window.prompt('Edit formula (LaTeX):', node.attrs.latex);
            if (latex != null) {
              editor?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run();
            }
          },
        },
      }),
    ],
    content: value,
    onCreate: ({ editor }) => {
      // Convert legacy `$…$` / `$$…$$` text into interactive math nodes.
      migrateMath(editor);
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getHTML());
    },
    editorProps: {
      handlePaste: (_, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) return true;
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              editor?.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        // Convert LaTeX in pasted plain text into math nodes. Handles `$$…$$`
        // block math (incl. multi-line) and `$…$` inline math, which the
        // extension's own migration cannot do on paste.
        const text = event.clipboardData?.getData('text/plain');
        if (text && hasMathDelimiters(text)) {
          event.preventDefault();
          editor?.chain().focus().insertContent(parsePastedMath(text)).run();
          return true;
        }
        return false;
      },
      handleDrop: (_, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              editor?.chain().focus().setImage({ src }).run();
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
  });

  // Sync a lazily-arriving external value into the (otherwise uncontrolled) editor.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if ((value ?? '') === current) return;
    editor.commands.setContent(value ?? '', { emitUpdate: false });
  }, [editor, value]);

  const insertInlineMath = useCallback(() => {
    if (!editor) return;
    const latex = window.prompt('Formula (LaTeX):', '');
    if (latex) editor.chain().focus().insertInlineMath({ latex }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rich-editor">
      <BubbleMenu
        editor={editor}
        className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface px-1.5 py-1 shadow-lg"
      >
        <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <Strikethrough size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
          <Code size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <Code2 size={15} />
        </ToolBtn>
        <Sep />
        <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          <Heading1 size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          <Heading2 size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          <Heading3 size={15} />
        </ToolBtn>
        <Sep />
        <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">
          <ListOrdered size={15} />
        </ToolBtn>
        <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          <Quote size={15} />
        </ToolBtn>
        <Sep />
        <ToolBtn
          active={editor.isActive('link')}
          onClick={() => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run();
            } else {
              const url = window.prompt('Link URL:');
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }
          }}
          title="Link"
        >
          <LinkIcon size={15} />
        </ToolBtn>
        <ToolBtn active={false} onClick={insertInlineMath} title="Insert formula">
          <Sigma size={15} />
        </ToolBtn>
      </BubbleMenu>

      <EditorContent editor={editor} />
    </div>
  );
}

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded p-1.5 transition-colors ${
        active ? 'bg-accent text-accent-contrast' : 'text-muted hover:bg-surface-2 hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="mx-1 w-px self-stretch bg-border" />;
}
