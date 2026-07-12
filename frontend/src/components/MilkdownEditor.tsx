import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewOptionsCtx, parserCtx, prosePluginsCtx } from '@milkdown/kit/core';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import { blockConfig } from '@milkdown/kit/plugin/block';
import { Slice } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Ctx } from '@milkdown/kit/ctx';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import 'katex/dist/katex.min.css';

/**
 * Make math render reliably regardless of how it was written.
 *
 * remark-math (used by Crepe) only produces a *block* (display) formula when
 * the `$$` fences sit on their own lines. A one-line `$$ … $$` — what LLMs and
 * pasted answers usually contain — is not recognized and shows up as raw text.
 * LLMs also frequently use `\( … \)` / `\[ … \]` delimiters that remark-math
 * doesn't recognize at all. Normalize all of these so they become proper
 * `$ … $` (inline) or block `$$` (display) math. Fenced code blocks and inline
 * code spans are left untouched.
 */
function normalizeMathDelimiters(markdown: string): string {
  if (!markdown) return markdown;
  const toBlock = (body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`;
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // code fence / inline code — untouched
      return (
        segment
          // \[ … \]  ->  block $$ … $$
          .replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => toBlock(body))
          // \( … \)  ->  inline $ … $
          .replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => `$${body.trim()}$`)
          // one-line $$ … $$  ->  block form so it renders as display math
          .replace(/\$\$([^\n]*?)\$\$/g, (_m, body) => toBlock(body))
      );
    })
    .join('');
}

interface MilkdownEditorProps {
  /** Initial markdown value. The editor is uncontrolled after mount. */
  value: string;
  onChange: (markdown: string) => void;
}

/**
 * Configure paste handling.
 *
 * Copying from VS Code, an LLM chat, or another editor puts *rich HTML* on the
 * clipboard. ProseMirror always prefers that HTML when it exists, and the
 * monospace / `<pre>`-flavored markup makes Crepe drop the whole paste into a
 * single raw code block instead of parsing it as markdown. To avoid that we
 * take over the paste event, read only the `text/plain` markdown, normalize its
 * math delimiters, and run it through Milkdown's own markdown parser — so
 * headings, paragraphs and `$$…$$` render as rich content and only genuine
 * ```` ``` ```` fences stay as code blocks.
 */
/**
 * Show math as a *clean rendered formula* and code as *code*.
 *
 * Crepe's Latex feature renders `$$…$$` / ```` ```math ```` through the shared
 * code-block component: it injects a KaTeX `renderPreview` into
 * `codeBlockConfig`. By default the block shows BOTH the LaTeX source
 * (CodeMirror) and the rendered preview side by side (the "code editor +
 * PREVIEW" widget). Setting `previewOnlyByDefault: true` collapses the source
 * so a math block displays only the rendered formula. Plain fenced code blocks
 * have no preview (their `renderPreview` returns null), and the node-view only
 * hides the source when a preview actually exists — so ```` ``` ```` fences keep
 * showing their raw source as code.
 *
 * We keep the feature's `renderPreview` (never override it) — clobbering it
 * disables math rendering entirely.
 */
function preferRenderedMath(ctx: Ctx): void {
  ctx.update(codeBlockConfig.key, (prev) => ({
    ...prev,
    previewOnlyByDefault: true,
  }));
}

/**
 * Keep the block-edit handle (the "+" / drag buttons) in the left gutter.
 *
 * Crepe anchors that handle to the node under the editor's horizontal center.
 * Its default `filterNodes` only rejects *ancestor* table/blockquote/math_inline
 * nodes via `findParent`, but an inline formula (`math_inline`) is an atom leaf —
 * it's the node AT the hovered position, never an ancestor — so it's never
 * rejected. When the center line falls on an inline formula the handle latches
 * onto the KaTeX span and renders in the middle of the paragraph, over the text.
 * Reject any inline node so the handle walks up to the enclosing block.
 */
function keepBlockHandleInGutter(ctx: Ctx): void {
  ctx.update(blockConfig.key, (prev) => ({
    ...prev,
    filterNodes: (pos, node) => {
      if (node?.isInline) return false;
      return prev.filterNodes ? prev.filterNodes(pos, node) : true;
    },
  }));
}

const thickCaretKey = new PluginKey<boolean>('thickCaret');

/**
 * Draw a thicker, high-contrast text caret in the editor.
 *
 * The native caret is only 1px wide and stays hard to notice in every theme,
 * regardless of color. We hide it via CSS (`caret-color: transparent`) and
 * render our own wider blinking bar (`.thick-caret`) as a widget decoration at
 * the cursor — but only while the editor is focused and the selection is an
 * empty text cursor, so it never shows while a code block (CodeMirror, which
 * draws its own cursor) is being edited.
 */
function thickCaretPlugin(): Plugin {
  return new Plugin({
    key: thickCaretKey,
    state: {
      init: () => false,
      apply: (tr, focused) => {
        const next = tr.getMeta(thickCaretKey);
        return typeof next === 'boolean' ? next : focused;
      },
    },
    props: {
      handleDOMEvents: {
        focus: (view) => {
          view.dispatch(view.state.tr.setMeta(thickCaretKey, true));
          return false;
        },
        blur: (view) => {
          view.dispatch(view.state.tr.setMeta(thickCaretKey, false));
          return false;
        },
      },
      decorations: (state) => {
        const focused = thickCaretKey.getState(state);
        const { selection } = state;
        if (!focused || !selection.empty) return DecorationSet.empty;
        const caret = Decoration.widget(
          selection.head,
          () => {
            const el = document.createElement('span');
            el.className = 'thick-caret';
            el.setAttribute('aria-hidden', 'true');
            return el;
          },
          { side: -1, key: 'thick-caret' },
        );
        return DecorationSet.create(state.doc, [caret]);
      },
    },
  });
}

function addThickCaret(ctx: Ctx): void {
  ctx.update(prosePluginsCtx, (prev) => [...prev, thickCaretPlugin()]);
}

function configurePasteHandling(ctx: Ctx): void {
  ctx.update(editorViewOptionsCtx, (prev) => ({
    ...prev,
    handlePaste: (view, event) => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return false; // no plain text (e.g. image) — let default handling run

      const parser = ctx.get(parserCtx);
      const doc = parser(normalizeMathDelimiters(text));
      if (!doc) return false;

      const slice = new Slice(doc.content, 0, 0);
      view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
      return true; // handled — skip ProseMirror's HTML paste path
    },
  }));
}

/**
 * Wraps Milkdown Crepe — a markdown-native WYSIWYG editor that handles
 * pasted LLM answers (code blocks, tables, math) smoothly.
 *
 * The editor is uncontrolled: remount it with a `key` to load new content.
 */
export function MilkdownEditor({ value, onChange }: MilkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const crepe = new Crepe({
      root: host,
      defaultValue: normalizeMathDelimiters(value),
      features: {
        // Hide the "Please enter..." hint that appears on every empty line.
        [Crepe.Feature.Placeholder]: false,
      },
      featureConfigs: {
        // Don't let a single malformed formula blow up the whole render.
        [Crepe.Feature.Latex]: {
          katexOptions: { throwOnError: false },
        },
      },
    });

    crepe.editor
      .config(preferRenderedMath)
      .config(configurePasteHandling)
      .config(keepBlockHandleInGutter)
      .config(addThickCaret);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
      });
    });

    let destroyed = false;
    crepe.create().then(() => {
      if (destroyed) crepe.destroy();
    });

    return () => {
      destroyed = true;
      crepe.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="milkdown-host" />;
}
