import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewOptionsCtx, parserCtx } from '@milkdown/kit/core';
import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import { Slice } from '@milkdown/kit/prose/model';
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
      featureConfigs: {
        // Don't let a single malformed formula blow up the whole render.
        [Crepe.Feature.Latex]: {
          katexOptions: { throwOnError: false },
        },
      },
    });

    crepe.editor.config(preferRenderedMath).config(configurePasteHandling);

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
