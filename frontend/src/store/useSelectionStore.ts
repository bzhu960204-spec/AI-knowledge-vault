import { create } from 'zustand';

interface SelectionState {
  selectedFolderId: number | null;
  selectedNoteId: number | null;
  activeTag: string | null;
  selectFolder: (id: number | null) => void;
  selectNote: (id: number | null) => void;
  selectTag: (tag: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedFolderId: null,
  selectedNoteId: null,
  activeTag: null,
  selectFolder: (id) =>
    set({ selectedFolderId: id, activeTag: null, selectedNoteId: null }),
  selectNote: (id) => set({ selectedNoteId: id }),
  selectTag: (tag) =>
    set({ activeTag: tag, selectedFolderId: null, selectedNoteId: null }),
}));
