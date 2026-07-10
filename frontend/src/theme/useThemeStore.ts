import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  type AccentId,
  type ThemeId,
} from './themes';

interface ThemeState {
  theme: ThemeId;
  accent: AccentId;
  setTheme: (theme: ThemeId) => void;
  setAccent: (accent: AccentId) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      accent: DEFAULT_ACCENT,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
    }),
    { name: 'ai-vault-theme' },
  ),
);

/** Applies the current theme + accent to the <html> element. */
export function applyTheme(theme: ThemeId, accent: AccentId): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-accent', accent);
}
