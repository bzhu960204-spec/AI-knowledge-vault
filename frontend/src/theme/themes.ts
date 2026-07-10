export type ThemeId = 'light' | 'dark' | 'dashboard' | 'sepia' | 'contrast';
export type AccentId = 'indigo' | 'emerald' | 'violet' | 'rose' | 'amber';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** Swatch colors used to preview the theme in the switcher. */
  swatch: { bg: string; surface: string; text: string };
}

export interface AccentOption {
  id: AccentId;
  label: string;
  color: string;
}

export const THEMES: ThemeOption[] = [
  {
    id: 'light',
    label: 'Light Minimal',
    description: 'Clean, Notion-like light workspace',
    swatch: { bg: '#ffffff', surface: '#f7f7f5', text: '#37352f' },
  },
  {
    id: 'dark',
    label: 'Dark Developer',
    description: 'Code-editor dark theme',
    swatch: { bg: '#0d1117', surface: '#161b22', text: '#e6edf3' },
  },
  {
    id: 'dashboard',
    label: 'Modern Dashboard',
    description: 'Cards and soft shadows',
    swatch: { bg: '#f1f5f9', surface: '#ffffff', text: '#1e293b' },
  },
  {
    id: 'sepia',
    label: 'Sepia Reading',
    description: 'Warm, easy on the eyes',
    swatch: { bg: '#f4ecd8', surface: '#faf3e0', text: '#4a3f2f' },
  },
  {
    id: 'contrast',
    label: 'High Contrast',
    description: 'Maximum readability',
    swatch: { bg: '#000000', surface: '#141414', text: '#ffffff' },
  },
];

export const ACCENTS: AccentOption[] = [
  { id: 'indigo', label: 'Indigo', color: '#6366f1' },
  { id: 'emerald', label: 'Emerald', color: '#10b981' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
];

export const DEFAULT_THEME: ThemeId = 'light';
export const DEFAULT_ACCENT: AccentId = 'indigo';
