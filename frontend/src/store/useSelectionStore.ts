import { create } from 'zustand';

/** Controls how much detail each note row shows in the list. */
export type ListDensity = 'comfortable' | 'compact';

/** Where a dragged folder will land relative to the folder it hovers over. */
export type FolderDropPosition = 'before' | 'after' | 'into';

const DENSITY_STORAGE_KEY = 'noteListDensity';

function readStoredDensity(): ListDensity {
  const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
  return stored === 'compact' ? 'compact' : 'comfortable';
}

interface SelectionState {
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  activeTag: string | null;
  includeSubfolders: boolean;
  /** When true the note list shows checkboxes for multi-select export. */
  exportMode: boolean;
  checkedNoteIds: number[];
  /** Compact hides excerpt/tags so more notes fit on screen. */
  density: ListDensity;
  /** Folder currently hovered while dragging another folder (drop indicator). */
  folderDropTargetId: number | null;
  folderDropPosition: FolderDropPosition | null;
  /** True while hovering the empty area below the tree (append to root end). */
  folderDropRootEnd: boolean;
  selectFolder: (id: number | null) => void;
  selectNote: (id: number | null) => void;
  selectTag: (tag: string | null) => void;
  setIncludeSubfolders: (value: boolean) => void;
  setExportMode: (value: boolean) => void;
  toggleChecked: (id: number) => void;
  setChecked: (ids: number[]) => void;
  clearChecked: () => void;
  setDensity: (value: ListDensity) => void;
  setFolderDrop: (
    targetId: number | null,
    position: FolderDropPosition | null,
    rootEnd?: boolean,
  ) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedFolderId: null,
  selectedNoteId: null,
  activeTag: null,
  includeSubfolders: false,
  exportMode: false,
  checkedNoteIds: [],
  density: readStoredDensity(),
  folderDropTargetId: null,
  folderDropPosition: null,
  folderDropRootEnd: false,
  selectFolder: (id) =>
    set({
      selectedFolderId: id,
      activeTag: null,
      selectedNoteId: null,
      includeSubfolders: false,
      exportMode: false,
      checkedNoteIds: [],
    }),
  selectNote: (id) => set({ selectedNoteId: id }),
  selectTag: (tag) =>
    set({
      activeTag: tag,
      selectedFolderId: null,
      selectedNoteId: null,
      includeSubfolders: false,
      exportMode: false,
      checkedNoteIds: [],
    }),
  setIncludeSubfolders: (value) => set({ includeSubfolders: value }),
  setExportMode: (value) =>
    set((s) => ({
      exportMode: value,
      checkedNoteIds: value ? s.checkedNoteIds : [],
    })),
  toggleChecked: (id) =>
    set((s) => ({
      checkedNoteIds: s.checkedNoteIds.includes(id)
        ? s.checkedNoteIds.filter((x) => x !== id)
        : [...s.checkedNoteIds, id],
    })),
  setChecked: (ids) => set({ checkedNoteIds: ids }),
  clearChecked: () => set({ checkedNoteIds: [] }),
  setDensity: (value) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, value);
    set({ density: value });
  },
  setFolderDrop: (targetId, position, rootEnd = false) =>
    set({
      folderDropTargetId: targetId,
      folderDropPosition: position,
      folderDropRootEnd: rootEnd,
    }),
}));
