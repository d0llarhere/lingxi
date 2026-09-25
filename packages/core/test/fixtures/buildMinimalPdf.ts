// Hand-rolled minimal PDF writer, test-only. Builds a real, valid, parseable
// PDF with a controllable number of pages and per-page text lines (or none,
// to simulate a scanned/image-only page with no text layer) — avoids checking
// in opaque binary fixture files, and byte offsets are computed exactly
// rather than hardcoded, so the fixture stays correct as content changes.

function escapePdfString(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildMinimalPdf(pages: string[][]): Uint8Array {
  const pageObjIds = pages.map((_, i) => 4 + i * 2);
  const contentObjIds = pages.map((_, i) => 5 + i * 2);
  const objects: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  ];

  pages.forEach((lines, i) => {
    let stream = '';
    if (lines.length > 0) {
      let y = 700;
      stream += 'BT\n/F1 12 Tf\n';
      for (const line of lines) {
        stream += `1 0 0 1 72 ${y} Tm\n(${escapePdfString(line)}) Tj\n`;
        y -= 40;
      }
      stream += 'ET';
    }

    objects.push(
      `${pageObjIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjIds[i]} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentObjIds[i]} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  let runningOffset = header.length;
  for (const obj of objects) {
    offsets.push(runningOffset);
    body += obj;
    runningOffset += obj.length;
  }

  const xrefOffset = header.length + body.length;
  const totalObjects = objects.length + 1;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(header + body + xref + trailer);
}
