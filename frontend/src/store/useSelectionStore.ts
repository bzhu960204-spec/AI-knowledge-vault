import { create } from 'zustand';

interface SelectionState {
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  activeTag: string | null;
  includeSubfolders: boolean;
  selectFolder: (id: number | null) => void;
  selectNote: (id: number | null) => void;
  selectTag: (tag: string | null) => void;
  setIncludeSubfolders: (value: boolean) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedFolderId: null,
  selectedNoteId: null,
  activeTag: null,
  includeSubfolders: false,
  selectFolder: (id) =>
    set({
      selectedFolderId: id,
      activeTag: null,
      selectedNoteId: null,
      includeSubfolders: false,
    }),
  selectNote: (id) => set({ selectedNoteId: id }),
  selectTag: (tag) =>
    set({
      activeTag: tag,
      selectedFolderId: null,
      selectedNoteId: null,
      includeSubfolders: false,
    }),
  setIncludeSubfolders: (value) => set({ includeSubfolders: value }),
}));
