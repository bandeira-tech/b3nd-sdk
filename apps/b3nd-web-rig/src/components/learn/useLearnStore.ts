import { create } from "zustand";

/**
 * Pure navigation state — where the user is in the book/chapter/section
 * hierarchy. No data. All content lives at URIs and is read through the
 * b3nd client by the components that render it.
 */
interface LearnStore {
  activeBook: string | null;
  activeChapter: string | null;
  activeSectionId: string | null;

  openBook: (key: string) => void;
  closeBook: () => void;
  openChapter: (key: string) => void;
  closeChapter: () => void;
  setActiveSectionId: (id: string | null) => void;
}

export const useLearnStore = create<LearnStore>((set) => ({
  activeBook: null,
  activeChapter: null,
  activeSectionId: null,

  openBook: (key) => set({ activeBook: key, activeChapter: null, activeSectionId: null }),
  closeBook: () => set({ activeBook: null, activeChapter: null, activeSectionId: null }),
  openChapter: (key) => set({ activeChapter: key, activeSectionId: null }),
  closeChapter: () => set({ activeChapter: null, activeSectionId: null }),
  setActiveSectionId: (id) => set({ activeSectionId: id }),
}));
