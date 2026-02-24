import {
  FileEdit,
  Plus,
  ArrowLeft,
  Clock,
  FileText,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { cn } from "../../utils";
import type { EditorDocument } from "./EditorLayoutSlot";

interface EditorLeftSlotProps {
  documents: EditorDocument[];
  activeDocId: string | null;
  viewingVersionIndex: number | null;
  onNewDocument: (title: string) => string;
  onOpenDocument: (id: string) => void;
  onCloseDocument: () => void;
  onViewVersion: (index: number | null) => void;
}

export function EditorLeftSlot({
  documents,
  activeDocId,
  viewingVersionIndex,
  onNewDocument,
  onOpenDocument,
  onCloseDocument,
  onViewVersion,
}: EditorLeftSlotProps) {
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null;

  return (
    <div className="h-full flex flex-col">
      {activeDoc === null ? (
        <IndexMode
          documents={documents}
          onNewDocument={onNewDocument}
          onOpenDocument={onOpenDocument}
        />
      ) : (
        <DocumentMode
          doc={activeDoc}
          viewingVersionIndex={viewingVersionIndex}
          onClose={onCloseDocument}
          onViewVersion={onViewVersion}
        />
      )}
    </div>
  );
}

/* -- Index Mode -------------------------------------------------- */

function IndexMode({
  documents,
  onNewDocument,
  onOpenDocument,
}: {
  documents: EditorDocument[];
  onNewDocument: (title: string) => string;
  onOpenDocument: (id: string) => void;
}) {
  return (
    <>
      {/* Header */}
      <div className="p-3 border-b border-border bg-card flex items-center gap-2">
        <FileEdit className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Editor</span>
      </div>

      {/* New Document button */}
      <div className="px-3 py-2 border-b border-border">
        <button
          onClick={() => onNewDocument("Untitled")}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90 transition-colors",
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Document</span>
        </button>
      </div>

      {/* Document list */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {documents.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground/60 text-center">
            No documents yet
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {documents.map((doc) => {
              const lastModified = doc.versions.length > 0
                ? doc.versions[0].timestamp
                : null;
              // Check latest version for encryption/auth status
              const latestVersion = doc.versions.length > 0 ? doc.versions[0] : null;
              const hasEncrypted = latestVersion?.encrypted;
              const hasSigned = !!latestVersion?.signedBy;

              return (
                <button
                  key={doc.id}
                  onClick={() => onOpenDocument(doc.id)}
                  className={cn(
                    "w-full flex flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                    "hover:bg-accent/50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium text-foreground truncate">
                      {doc.title}
                    </span>
                    <div className="ml-auto flex items-center gap-1 shrink-0">
                      {hasSigned && (
                        <ShieldCheck className="w-3 h-3 text-blue-500/60" />
                      )}
                      {hasEncrypted && (
                        <Lock className="w-3 h-3 text-amber-500/60" />
                      )}
                    </div>
                  </div>
                  {lastModified && (
                    <div className="text-[10px] text-muted-foreground pl-[22px]">
                      {new Date(lastModified).toLocaleString()}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/* -- Document Mode ----------------------------------------------- */

function DocumentMode({
  doc,
  viewingVersionIndex,
  onClose,
  onViewVersion,
}: {
  doc: EditorDocument;
  viewingVersionIndex: number | null;
  onClose: () => void;
  onViewVersion: (index: number | null) => void;
}) {
  return (
    <>
      {/* Back button + document title */}
      <div className="border-b border-border bg-card">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All Documents</span>
        </button>
        <div className="px-3 pb-2">
          <span className="text-sm font-medium text-foreground">{doc.title}</span>
        </div>
      </div>

      {/* Version history */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            <Clock className="w-3 h-3" />
            <span>Version history</span>
            {doc.versions.length > 0 && (
              <span className="ml-auto text-muted-foreground/60">{doc.versions.length}</span>
            )}
          </div>
        </div>

        {doc.versions.length === 0 ? (
          <div className="px-3 text-xs text-muted-foreground/60">
            No saves yet
          </div>
        ) : (
          <div className="flex flex-col">
            {/* Return to editing button when viewing history */}
            {viewingVersionIndex !== null && (
              <button
                onClick={() => onViewVersion(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/50 transition-colors text-primary font-medium"
              >
                Back to editing
              </button>
            )}

            {doc.versions.map((version, i) => {
              const isSelected = viewingVersionIndex === i;
              const versionNumber = doc.versions.length - i;
              return (
                <button
                  key={`${version.hashUri}-${version.timestamp}`}
                  onClick={() => onViewVersion(isSelected ? null : i)}
                  className={cn(
                    "w-full flex flex-col gap-0.5 px-3 py-2 text-left text-xs transition-colors",
                    "hover:bg-accent/50",
                    isSelected && "bg-accent/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-foreground font-medium">
                      #{versionNumber}
                    </span>
                    {/* Security badges */}
                    <div className="flex items-center gap-1">
                      {version.signedBy && (
                        <ShieldCheck className="w-3 h-3 text-blue-500/60" />
                      )}
                      {version.encrypted && (
                        <Lock className="w-3 h-3 text-amber-500/60" />
                      )}
                    </div>
                    {i === 0 && (
                      <span className="ml-auto text-[10px] text-primary font-medium">latest</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(version.timestamp).toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
