import { extractText as extractTextFromPdf, getDocumentProxy } from 'unpdf';

const MAX_EXTRACTED_TEXT_CHARS = 250_000;

export async function extractPdfText(bytes: Buffer): Promise<string> {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('attachment_is_not_pdf');
  }

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractTextFromPdf(pdf, { mergePages: true });
  return (text ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}
