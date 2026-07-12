import { create } from 'zustand';

interface SelectionState {
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  activeTag: string | null;
  includeSubfolders: boolean;
  /** When true the note list shows checkboxes for multi-select export. */
  exportMode: boolean;
  checkedNoteIds: number[];
  selectFolder: (id: number | null) => void;
  selectNote: (id: number | null) => void;
  selectTag: (tag: string | null) => void;
  setIncludeSubfolders: (value: boolean) => void;
  setExportMode: (value: boolean) => void;
  toggleChecked: (id: number) => void;
  setChecked: (ids: number[]) => void;
  clearChecked: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedFolderId: null,
  selectedNoteId: null,
  activeTag: null,
  includeSubfolders: false,
  exportMode: false,
  checkedNoteIds: [],
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
}));
