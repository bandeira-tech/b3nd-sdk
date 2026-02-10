import { create } from "zustand";

interface LearnStore {
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
}

export const useLearnStore = create<LearnStore>((set) => ({
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
