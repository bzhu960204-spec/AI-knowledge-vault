import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { marked } from 'marked';
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

// ── Fenced code detection (for paste) ────────────────────────────────────────
// Fenced code block ```lang\n…\n``` — anywhere in the text, not just as the
// whole clipboard. `[^\n]*` captures an optional language label.
const FENCE_RE = /```([^\n]*)\n([\s\S]*?)\n?```/g;

/** True if the pasted text contains a fenced code block. */
function hasFencedCode(text: string): boolean {
  FENCE_RE.lastIndex = 0;
  return FENCE_RE.test(text);
}

/**
 * Render pasted Markdown to HTML.
 *
 * LLM answers are Markdown, and the clipboard's own HTML often flattens fenced
 * code diagrams (collapsing the whitespace ASCII / box-drawing art relies on)
 * or drops structure. Rendering the Markdown ourselves keeps headings, lists,
 * links, bold, code blocks (whitespace intact) all correct.
 *
 * LaTeX is shielded with placeholders first so Markdown doesn't mangle it (e.g.
 * `a_b` → emphasis); the literal `$…$` / `$$…$$` is restored afterwards and
 * left as plain text (the user renders it to math manually via the toolbar).
 */
function renderMarkdown(md: string): string {
  const math: string[] = [];
  const stash = (m: string) => `\u0000M${math.push(m) - 1}\u0000`;
  const shielded = md
    .replace(/\$\$[\s\S]+?\$\$/g, stash)
    .replace(/\$(?!\d+\$)[^\n]+?\$(?!\d)/g, stash);
  const html = marked.parse(shielded, { gfm: true, breaks: false, async: false }) as string;
  return html.replace(/\u0000M(\d+)\u0000/g, (_, i) => math[Number(i)]);
}

// Math nodes with their built-in input rules stripped. The library's InlineMath
// (`$$…$$`) and BlockMath (`$$$…$$$`) input rules auto-convert dollar-delimited
// text on typing/paste; we remove them so `$…$` / `$$…$$` stays literal until the
// user renders it manually via the toolbar. Nodes, commands, node views and
// click handlers are all kept.
const InlineMathNoRules = InlineMath.extend({
  addInputRules() {
    return [];
  },
});
const BlockMathNoRules = BlockMath.extend({
  addInputRules() {
    return [];
  },
});

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
 * and formatting survive verbatim. Pasted LaTeX (`$…$` / `$$…$$`) stays as plain
 * text; the user renders a selection to an interactive math node on demand via
 * the toolbar's formula button (Mathematics extension).
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
      InlineMathNoRules.configure({
        katexOptions: { throwOnError: false },
        onClick: (node, pos) => {
          const latex = window.prompt('Edit formula (LaTeX):', node.attrs.latex);
          if (latex != null) {
            editor?.chain().setNodeSelection(pos).updateInlineMath({ latex }).focus().run();
          }
        },
      }),
      BlockMathNoRules.configure({
        katexOptions: { throwOnError: false },
        onClick: (node, pos) => {
          const latex = window.prompt('Edit formula (LaTeX):', node.attrs.latex);
          if (latex != null) {
            editor?.chain().setNodeSelection(pos).updateBlockMath({ latex }).focus().run();
          }
        },
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getHTML());
    },
    editorProps: {
      // Answers don't support images. Strip any <img> that rides along in a
      // rich HTML paste (e.g. copied web/Word content) before it's inserted.
      transformPastedHTML: (html) => html.replace(/<img\b[^>]*>/gi, ''),
      handlePaste: (_, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
              // Drop pasted image data instead of inserting it into the answer.
              event.preventDefault();
              return true;
            }
          }
        }
        const text = event.clipboardData?.getData('text/plain');
        // Fenced code blocks can't survive the clipboard's own HTML (the
        // whitespace ASCII / box-drawing diagrams rely on collapses), so when
        // the paste contains a code fence we render the Markdown ourselves via
        // `marked` (this also handles any math inside it). Narrowed to fences
        // only, so ordinary rich pastes keep their clipboard HTML untouched.
        if (text && hasFencedCode(text)) {
          event.preventDefault();
          editor?.chain().focus().insertContent(renderMarkdown(text)).run();
          return true;
        }
        // Otherwise keep TipTap's native paste (preserves rich clipboard HTML).
        // Math is NOT auto-converted: `$…$` / `$$…$$` stays as literal text until
        // the user selects it and applies the formula button.
        return false;
      },
      handleDrop: (_, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/')) {
            // Answers don't support images: swallow dropped image files.
            event.preventDefault();
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

  // Render the current selection as math. `$$…$$` becomes a block formula,
  // `$…$` (or a bare selection) an inline one. With no selection, prompt for a
  // new inline formula. This is the ONLY path that turns text into math, so
  // pasted `$…$` stays literal until the user opts in here.
  const applyMath = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      const latex = window.prompt('Formula (LaTeX):', '');
      if (latex) editor.chain().focus().insertInlineMath({ latex }).run();
      return;
    }
    const selected = editor.state.doc.textBetween(from, to, '\n').trim();
    const block = /^\$\$([\s\S]+)\$\$$/.exec(selected);
    if (block) {
      editor.chain().focus().deleteSelection().insertBlockMath({ latex: block[1].trim() }).run();
      return;
    }
    const inline = /^\$([^\n]+)\$$/.exec(selected);
    const latex = (inline ? inline[1] : selected).trim();
    editor.chain().focus().deleteSelection().insertInlineMath({ latex }).run();
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
        <ToolBtn active={false} onClick={applyMath} title="Render selection as formula">
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
