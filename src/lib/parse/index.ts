import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

export type ResumeKind = "pdf" | "docx" | "png" | "jpeg";

export const RESUME_MIME: Record<ResumeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpeg: "image/jpeg",
};

export function detectResumeType(fileName: string, bytes: Buffer): ResumeKind | null {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG") return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
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
  if (kind === "png" || kind === "jpeg") return { text: "", pages: 1 }; // images always go through OCR
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { text: value.trim(), pages: 0 };
  }
  throw new Error("Unsupported file type — upload a PDF, DOCX, PNG or JPEG");
}
