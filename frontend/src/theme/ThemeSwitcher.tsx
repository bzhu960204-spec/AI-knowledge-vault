import { useEffect, useState, useRef } from 'react';
import { ACCENTS, THEMES } from './themes';
import { applyTheme, useThemeStore } from './useThemeStore';

/** Applies the persisted theme to <html> whenever it changes. */
export function ThemeEffect() {
  const theme = useThemeStore((s) => s.theme);
  const accent = useThemeStore((s) => s.accent);
  useEffect(() => {
    applyTheme(theme, accent);
  }, [theme, accent]);
  return null;
}

export function ThemeSwitcher() {
  const { theme, accent, setTheme, setAccent } = useThemeStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const activeTheme = THEMES.find((t) => t.id === theme);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text transition hover:border-accent"
      >
        <span
          className="h-3 w-3 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        <span>{activeTheme?.label ?? 'Theme'}</span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-3 shadow-xl">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Theme
          </p>
          <div className="grid grid-cols-1 gap-1">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-2 ${
                  theme === t.id ? 'ring-1 ring-accent' : ''
                }`}
              >
                <span className="flex h-7 w-7 overflow-hidden rounded-md border border-border">
                  <span className="w-1/2" style={{ background: t.swatch.bg }} />
                  <span
                    className="w-1/2"
                    style={{ background: t.swatch.surface }}
                  />
                </span>
                <span className="flex-1">
                  <span className="block text-sm text-text">{t.label}</span>
                  <span className="block text-xs text-muted">
                    {t.description}
                  </span>
                </span>
                {theme === t.id && <span className="text-accent">✓</span>}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Accent
          </p>
          <div className="flex gap-2 px-1">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.label}
                onClick={() => setAccent(a.id)}
                className={`h-7 w-7 rounded-full border-2 transition ${
                  accent === a.id
                    ? 'border-text'
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ background: a.color }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
