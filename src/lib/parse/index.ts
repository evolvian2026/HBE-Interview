import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export function detectResumeType(fileName: string, bytes: Buffer): "pdf" | "docx" | null {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "pdf";
  // DOCX is a ZIP container ("PK\x03\x04") with a .docx name.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && /\.docx$/i.test(fileName)) return "docx";
  return null;
}

/** Extract plain text from a PDF or DOCX resume. */
export async function extractResumeText(fileName: string, bytes: Buffer): Promise<{ text: string; pages: number }> {
  const kind = detectResumeType(fileName, bytes);
  if (kind === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    return { text: String(text).replace(/[ \t]+\n/g, "\n").trim(), pages: totalPages };
  }
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { text: value.trim(), pages: 0 };
  }
  throw new Error("Unsupported file type — upload a PDF or DOCX");
}
