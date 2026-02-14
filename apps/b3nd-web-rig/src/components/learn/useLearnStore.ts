import { create } from "zustand";
import type { LearnDocument } from "./skillContent";

interface LearnStore {
  activeDocument: LearnDocument;
  activeSectionId: string | null;
  setActiveDocument: (doc: LearnDocument) => void;
  setActiveSectionId: (id: string | null) => void;
}

export const useLearnStore = create<LearnStore>((set) => ({
  activeDocument: "b3nd",
  activeSectionId: null,
  setActiveDocument: (doc) => set({ activeDocument: doc, activeSectionId: null }),
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
