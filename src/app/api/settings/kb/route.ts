import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { extractResumeText } from "@/lib/parse";

const Body = z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(200_000) });

/** Add an HR knowledge base document: JSON {title, content} or multipart file (PDF/DOCX/TXT/MD). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("admin");
  let title: string;
  let content: string;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) throw new Error("No file");
    const buf = Buffer.from(await file.arrayBuffer());
    title = String(form.get("title") || file.name.replace(/\.[^.]+$/, ""));
    content = /\.(txt|md)$/i.test(file.name) ? buf.toString("utf8") : (await extractResumeText(file.name, buf)).text;
  } else {
    ({ title, content } = Body.parse(await req.json()));
  }
  const [d] = await db.insert(schema.kbDocuments).values({ orgId: user.orgId, title, content: content.slice(0, 200_000) }).returning();
  return json({ id: d.id });
});
