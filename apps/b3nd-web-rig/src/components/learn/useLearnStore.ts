import { create } from "zustand";
import type { LearnDocument } from "./skillContent";

interface LearnStore {
  activeBook: LearnDocument | null;
  activeSectionId: string | null;
  openBook: (doc: LearnDocument) => void;
  closeBook: () => void;
  setActiveSectionId: (id: string | null) => void;
}

export const useLearnStore = create<LearnStore>((set) => ({
  activeBook: null,
  activeSectionId: null,
  openBook: (doc) => set({ activeBook: doc, activeSectionId: null }),
  closeBook: () => set({ activeBook: null, activeSectionId: null }),
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
