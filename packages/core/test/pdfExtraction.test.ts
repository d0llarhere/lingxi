import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../src/extraction/extractPdf';
import { buildMinimalPdf } from './fixtures/buildMinimalPdf';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('extractPdfText', () => {
  it('extracts text and preserves page boundaries across multiple pages', async () => {
    const pdf = buildMinimalPdf([['Page one content.'], ['Page two content.'], ['Page three content.']]);
    const result = await extractPdfText(toArrayBuffer(pdf));

    expect(result.hasText).toBe(true);
    expect(result.pages).toHaveLength(3);

    const [page0, page1, page2] = result.pages;
    if (!page0 || !page1 || !page2) throw new Error('expected 3 pages');

    expect(result.text.slice(page0.charStart, page0.charEnd)).toContain('Page one content.');
    expect(result.text.slice(page1.charStart, page1.charEnd)).toContain('Page two content.');
    expect(result.text.slice(page2.charStart, page2.charEnd)).toContain('Page three content.');
  });

  it('keeps page ranges non-overlapping and in order', async () => {
    const pdf = buildMinimalPdf([['First page.'], ['Second page.']]);
    const result = await extractPdfText(toArrayBuffer(pdf));

    const [page0, page1] = result.pages;
    if (!page0 || !page1) throw new Error('expected 2 pages');
    expect(page0.charStart).toBe(0);
    expect(page0.charEnd).toBeLessThanOrEqual(page1.charStart);
    expect(page1.charEnd).toBe(result.text.length);
  });

  it('does not drop text from multiple lines on the same page', async () => {
    const pdf = buildMinimalPdf([['First line of the page.', 'Second line of the page.']]);
    const result = await extractPdfText(toArrayBuffer(pdf));

    expect(result.text).toContain('First line of the page.');
    expect(result.text).toContain('Second line of the page.');
  });

  it('reports hasText:false for a page with no extractable text (scanned/image simulation)', async () => {
    const pdf = buildMinimalPdf([[]]);
    const result = await extractPdfText(toArrayBuffer(pdf));

    expect(result.hasText).toBe(false);
    expect(result.pages).toHaveLength(1);
    const [page0] = result.pages;
    if (!page0) throw new Error('expected 1 page');
    expect(page0.charStart).toBe(0);
    expect(page0.charEnd).toBe(0);
  });

  it('reports hasText:true when at least one page (of several) has text', async () => {
    const pdf = buildMinimalPdf([['Real text on page one.'], []]);
    const result = await extractPdfText(toArrayBuffer(pdf));

    expect(result.hasText).toBe(true);
    expect(result.pages).toHaveLength(2);
    const [, page1] = result.pages;
    if (!page1) throw new Error('expected 2 pages');
    expect(page1.charStart).toBe(page1.charEnd);
  });

  it('rejects for a malformed/corrupt PDF instead of returning garbage', async () => {
    const garbage = new TextEncoder().encode('this is not a pdf file at all');
    await expect(extractPdfText(toArrayBuffer(garbage))).rejects.toThrow();
  });
});
