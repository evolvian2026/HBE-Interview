import { z } from "zod";
import { requireCandidateSession } from "@/lib/auth/candidate-session";
import { HttpError } from "@/lib/auth/staff";
import { handle } from "@/lib/http";
import { handleTurn, type TurnEvent } from "@/lib/interview/orchestrator";

const Body = z.object({
  clientMsgId: z.string().max(64),
  text: z.string().max(4000),
  kind: z.enum(["open", "answer", "skip", "hint", "submitted"]),
  inputMode: z.enum(["text", "voice"]).optional(),
});

export const dynamic = "force-dynamic";

/** Candidate turn → streamed AI reply (Server-Sent Events). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ token: string; sid: string }> }) => {
  const { token, sid } = await params;
  await requireCandidateSession(token, sid);
  const body = Body.parse(await req.json());
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: TurnEvent) => {
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client went away; the turn still completes server-side */
        }
      };
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 10_000);
      try {
        await handleTurn(sid, body, send);
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        console.error("turn failed", e);
        send({ type: "error", message: e instanceof HttpError ? e.message : "We're having trouble right now — your progress is saved. Please try again.", retryable: status >= 500 || status === 409 });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
});
