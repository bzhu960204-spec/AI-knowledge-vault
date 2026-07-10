import { useState, type KeyboardEvent } from 'react';

interface TagInputProps {
  tags: string[];
  suggestions?: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ tags, suggestions = [], onChange }: TagInputProps) {
  const [input, setInput] = useState('');

  function addTag(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...tags, name]);
    setInput('');
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  }

  const available = suggestions.filter(
    (s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-xs text-accent"
            style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-accent/70 hover:text-accent"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => addTag(input)}
          placeholder={tags.length ? '' : 'Add tags…'}
          className="min-w-24 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          list="tag-suggestions"
        />
        <datalist id="tag-suggestions">
          {available.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
