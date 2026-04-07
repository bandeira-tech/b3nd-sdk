import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EditorMainContent } from "./EditorMainContent";
import { EditorLeftSlot } from "./EditorLeftSlot";

export interface EditorVersion {
  hashUri: string;
  linkUri: string;
  body: string;
  timestamp: number;
  /** Whether the stored content is encrypted */
  encrypted: boolean;
  /** The account public key (appKey) that signed this version, if any */
  signedBy: string | null;
  /** The encryption public key used to encrypt, if encrypted */
  encryptionPublicKeyHex: string | null;
}

export interface EditorDocument {
  id: string;
  title: string;
  versions: EditorVersion[];
}

export interface SaveVersionInput {
  docId: string;
  title: string;
  body: string;
  hashUri: string;
  linkUri: string;
  /** Whether the stored content was encrypted */
  encrypted: boolean;
  /** The account public key (appKey) that signed this version, if any */
  signedBy: string | null;
  /** The encryption public key used to encrypt, if encrypted */
  encryptionPublicKeyHex: string | null;
}

interface EditorState {
  documents: EditorDocument[];
  activeDocId: string | null;
  viewingVersionIndex: number | null;
  encryptionEnabled: boolean;
  addDocument: (title: string) => string;
  openDocument: (id: string) => void;
  closeDocument: () => void;
  saveVersion: (input: SaveVersionInput) => void;
  viewVersion: (index: number | null) => void;
  setEncryptionEnabled: (enabled: boolean) => void;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set) => ({
      documents: [],
      activeDocId: null,
      viewingVersionIndex: null,
      encryptionEnabled: false,

      addDocument: (title: string) => {
        const base = slugify(title) || "doc";
        const id = `${base}-${Date.now()}`;
        set((state) => ({
          documents: [
            ...state.documents,
            { id, title, versions: [] },
          ],
          activeDocId: id,
          viewingVersionIndex: null,
        }));
        return id;
      },

      openDocument: (id: string) => {
        set({ activeDocId: id, viewingVersionIndex: null });
      },

      closeDocument: () => {
        set({ activeDocId: null, viewingVersionIndex: null });
      },

      saveVersion: ({
        docId,
        title,
        body,
        hashUri,
        linkUri,
        encrypted,
        signedBy,
        encryptionPublicKeyHex,
      }: SaveVersionInput) => {
        set((state) => ({
          documents: state.documents.map((doc) =>
            doc.id === docId
              ? {
                ...doc,
                title,
                versions: [
                  {
                    hashUri,
                    linkUri,
                    body,
                    timestamp: Date.now(),
                    encrypted,
                    signedBy,
                    encryptionPublicKeyHex,
                  },
                  ...doc.versions,
                ],
              }
              : doc
          ),
          viewingVersionIndex: null,
        }));
      },

      viewVersion: (index: number | null) => {
        set({ viewingVersionIndex: index });
      },

      setEncryptionEnabled: (enabled: boolean) => {
        set({ encryptionEnabled: enabled });
      },
    }),
    {
      name: "b3nd-editor",
      partialize: (state) => ({
        documents: state.documents,
        encryptionEnabled: state.encryptionEnabled,
      }),
    },
  ),
);

export function EditorLeftSlotConnected() {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const viewingVersionIndex = useEditorStore((s) => s.viewingVersionIndex);
  const addDocument = useEditorStore((s) => s.addDocument);
  const openDocument = useEditorStore((s) => s.openDocument);
  const closeDocument = useEditorStore((s) => s.closeDocument);
  const viewVersion = useEditorStore((s) => s.viewVersion);

  return (
    <EditorLeftSlot
      documents={documents}
      activeDocId={activeDocId}
      viewingVersionIndex={viewingVersionIndex}
      onNewDocument={addDocument}
      onOpenDocument={openDocument}
      onCloseDocument={closeDocument}
      onViewVersion={viewVersion}
    />
  );
}

export function EditorMainSlotConnected() {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const viewingVersionIndex = useEditorStore((s) => s.viewingVersionIndex);
  const encryptionEnabled = useEditorStore((s) => s.encryptionEnabled);
  const addDocument = useEditorStore((s) => s.addDocument);
  const saveVersion = useEditorStore((s) => s.saveVersion);
  const viewVersion = useEditorStore((s) => s.viewVersion);
  const setEncryptionEnabled = useEditorStore((s) => s.setEncryptionEnabled);

  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;

  return (
    <EditorMainContent
      activeDoc={activeDoc}
      viewingVersionIndex={viewingVersionIndex}
      encryptionEnabled={encryptionEnabled}
      onAddDocument={addDocument}
      onSaveVersion={saveVersion}
      onViewVersion={viewVersion}
      onSetEncryptionEnabled={setEncryptionEnabled}
    />
  );
}
