// Separate store records, kept out of `LingxiDocument` so the frequently-read
// metadata list never has to deserialize large text/binary payloads.

export interface DocumentTextRecord {
  documentId: string;
  text: string;
}

// Populated starting in the PDF phase; the store exists from Phase 1 so
// deletion/cleanup logic is correct even before anything writes to it.
export interface SourceFileRecord {
  documentId: string;
  blob: Blob;
  filename: string;
  mimeType: string;
}
