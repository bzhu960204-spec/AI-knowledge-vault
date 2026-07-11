import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { arrayMove } from '@dnd-kit/sortable';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { FolderTree } from './components/FolderTree';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SearchModal } from './components/SearchModal';
import { ThemeSwitcher } from './theme/ThemeSwitcher';
import { useFolders, useUpdateFolder } from './hooks/useFolders';
import { useMoveNote, useNotes, useReorderNotes } from './hooks/useNotes';
import { useSelectionStore } from './store/useSelectionStore';

/** Data attached to a draggable item, read during drag handling. */
type DragData =
  | { type: 'note'; title: string; folderId: number | null }
  | { type: 'folder'; name: string; parentId: number | null };

/** Keeps the drag overlay centered on the cursor so it never drifts away. */
const snapToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const coords = getEventCoordinates(activatorEvent);
  if (!coords) return transform;
  return {
    ...transform,
    x: transform.x + coords.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + coords.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

/** Panel sizes (percent of the group width) used by the collapse toggles. */
const COLLAPSED = 3;
const FOLDER_OPEN = 18;
const NOTES_OPEN = 22;

export default function App() {
  const selectedNoteId = useSelectionStore((s) => s.selectedNoteId);
  const selectedFolderId = useSelectionStore((s) => s.selectedFolderId);
  const activeTag = useSelectionStore((s) => s.activeTag);
  const [searchOpen, setSearchOpen] = useState(false);
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const folderPanelRef = useRef<ImperativePanelHandle>(null);
  const listPanelRef = useRef<ImperativePanelHandle>(null);
  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const [folderCollapsed, setFolderCollapsed] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);

  const { data: folders = [] } = useFolders();
  const updateFolder = useUpdateFolder();
  const moveNote = useMoveNote();

  const noteParams = {
    folderId: activeTag ? undefined : selectedFolderId,
    tag: activeTag ?? undefined,
  };
  const { data: notes = [] } = useNotes(noteParams);
  const reorderNotes = useReorderNotes(noteParams);

  function toggleFolderPanel() {
    const g = groupRef.current;
    if (!g) return;
    const [f, n] = g.getLayout();
    const collapse = f > COLLAPSED + 0.5; // currently expanded -> collapse
    const folder = collapse ? COLLAPSED : FOLDER_OPEN;
    g.setLayout([folder, n, 100 - folder - n]); // keep notes size (n) untouched
    setFolderCollapsed(collapse);
  }

  function toggleListPanel() {
    const g = groupRef.current;
    if (!g) return;
    const [f, n] = g.getLayout();
    const collapse = n > COLLAPSED + 0.5;
    const notes = collapse ? COLLAPSED : NOTES_OPEN;
    g.setLayout([f, notes, 100 - f - notes]); // keep folder size (f) untouched
    setListCollapsed(collapse);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (!data) {
      setDragLabel(null);
      return;
    }
    setDragLabel(data.type === 'note' ? data.title : data.name);
  }

  function reorderWithinList(activeId: string, overId: string) {
    if (activeId === overId || activeTag) return; // no reorder in tag view
    const oldIndex = notes.findIndex((n) => `note:${n.id}` === activeId);
    const newIndex = notes.findIndex((n) => `note:${n.id}` === overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const orderedIds = arrayMove(notes, oldIndex, newIndex).map((n) => n.id);
    reorderNotes.mutate(orderedIds);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragLabel(null);
    const activeId = String(event.active.id);
    const overRaw = event.over?.id;
    if (overRaw == null) return;

    const overId = String(overRaw);
    const data = event.active.data.current as DragData | undefined;

    // Reorder within the note list: a note dropped onto another note.
    if (activeId.startsWith('note:') && overId.startsWith('note:')) {
      reorderWithinList(activeId, overId);
      return;
    }

    const targetFolderId =
      overId === 'root' ? null : Number(overId.replace('folder:', ''));

    if (activeId.startsWith('note:')) {
      // Move a note to another folder (ignore if already there).
      const noteId = Number(activeId.replace('note:', ''));
      if (data?.type === 'note' && data.folderId === targetFolderId) return;
      moveNote.mutate({ id: noteId, folderId: targetFolderId });
      return;
    }

    if (activeId.startsWith('folder:')) {
      // Reparent a folder.
      const folderId = Number(activeId.replace('folder:', ''));
      if (folderId === targetFolderId) return;
      const folder = folders.find((f) => f.id === folderId);
      if (!folder || folder.parentId === targetFolderId) return;
      updateFolder.mutate({
        id: folderId,
        body: { name: folder.name, parentId: targetFolderId },
      });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      <div className="flex h-screen flex-col bg-bg text-text">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleFolderPanel}
              title={folderCollapsed ? 'Show folders' : 'Hide folders'}
              className="rounded-md px-1.5 py-1 text-muted transition hover:bg-surface-2 hover:text-accent"
            >
              {folderCollapsed ? '▸' : '◂'}
            </button>
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

        {/* Three-pane body: resizable, collapsible, width persisted */}
        <PanelGroup
          ref={groupRef}
          direction="horizontal"
          autoSaveId="vault-layout"
          className="min-h-0 flex-1"
        >
          <Panel
            ref={folderPanelRef}
            order={1}
            defaultSize={18}
            minSize={12}
            collapsible
            collapsedSize={3}
            onCollapse={() => setFolderCollapsed(true)}
            onExpand={() => setFolderCollapsed(false)}
            className="min-h-0 border-r border-border bg-surface"
          >
            {folderCollapsed ? (
              <CollapsedRail
                icon="🗂️"
                label="Folders"
                onExpand={toggleFolderPanel}
              />
            ) : (
              <FolderTree onToggleCollapse={toggleFolderPanel} />
            )}
          </Panel>
          <ResizeHandle />
          <Panel
            ref={listPanelRef}
            order={2}
            defaultSize={22}
            minSize={15}
            collapsible
            collapsedSize={3}
            onCollapse={() => setListCollapsed(true)}
            onExpand={() => setListCollapsed(false)}
            className="min-h-0 border-r border-border bg-surface"
          >
            {listCollapsed ? (
              <CollapsedRail
                icon="📄"
                label="Notes"
                onExpand={toggleListPanel}
              />
            ) : (
              <NoteList onToggleCollapse={toggleListPanel} />
            )}
          </Panel>
          <ResizeHandle />
          <Panel order={3} defaultSize={60} className="min-h-0 bg-surface">
            {selectedNoteId ? (
              <NoteEditor noteId={selectedNoteId} />
            ) : (
              <EmptyState />
            )}
          </Panel>
        </PanelGroup>

        <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>

      <DragOverlay dropAnimation={null} modifiers={[snapToCursor]}>
        {dragLabel ? (
          <span className="pointer-events-none inline-block max-w-[220px] translate-x-3 translate-y-3 truncate rounded-md border border-border bg-surface/90 px-2 py-1 text-xs text-muted shadow-sm">
            {dragLabel || 'Untitled'}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-px bg-border outline-none transition data-[resize-handle-state=hover]:bg-accent data-[resize-handle-state=drag]:bg-accent">
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </PanelResizeHandle>
  );
}

function CollapsedRail({
  icon,
  label,
  onExpand,
}: {
  icon: string;
  label: string;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Show ${label}`}
      className="flex h-full w-full flex-col items-center gap-3 py-3 text-muted transition hover:bg-surface-2 hover:text-accent"
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="select-none text-xs font-semibold uppercase tracking-wide [writing-mode:vertical-rl]">
        {label}
      </span>
      <span className="mt-auto text-xs leading-none">▸</span>
    </button>
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
