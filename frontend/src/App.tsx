import { useEffect, useState } from 'react';
import { FolderTree } from './components/FolderTree';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SearchModal } from './components/SearchModal';
import { ThemeSwitcher } from './theme/ThemeSwitcher';
import { useSelectionStore } from './store/useSelectionStore';

export default function App() {
  const selectedNoteId = useSelectionStore((s) => s.selectedNoteId);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🗂️</span>
          <span className="font-semibold">AI Answer Vault</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted transition hover:border-accent"
          >
            <span>🔍</span>
            <span>Search</span>
            <kbd className="rounded border border-border px-1 text-[10px]">
              Ctrl K
            </kbd>
          </button>
          <ThemeSwitcher />
        </div>
      </header>

      {/* Three-pane body */}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_320px_1fr]">
        <aside className="min-h-0 border-r border-border bg-surface">
          <FolderTree />
        </aside>
        <section className="min-h-0 border-r border-border bg-surface">
          <NoteList />
        </section>
        <main className="min-h-0 bg-surface">
          {selectedNoteId ? (
            <NoteEditor noteId={selectedNoteId} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted">
      <span className="text-4xl">📋</span>
      <p className="text-lg text-text">Select or create a note</p>
      <p className="max-w-sm text-sm">
        Paste an LLM answer (Markdown with code blocks and math) — it renders
        instantly in the editor.
      </p>
    </div>
  );
}
