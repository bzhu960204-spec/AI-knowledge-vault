import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import 'katex/dist/katex.min.css';

interface MilkdownEditorProps {
  /** Initial markdown value. The editor is uncontrolled after mount. */
  value: string;
  onChange: (markdown: string) => void;
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

    const crepe = new Crepe({ root: host, defaultValue: value });
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
