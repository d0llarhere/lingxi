// Standard no-dependency browser download trigger — no existing precedent
// in this codebase to reuse (confirmed: no download links/exports anywhere
// else in the app).
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Strips characters that are unsafe/unusual in filenames across platforms,
// collapsing to a sane fallback if the title has nothing usable left.
export function safeFilenameStem(title: string): string {
  const cleaned = title.replace(/[^\w\- ]+/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'reading';
}
