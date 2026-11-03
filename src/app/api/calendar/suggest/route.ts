import { z } from "zod";
import { requireStaff } from "@/lib/auth/staff";
import { handle, json } from "@/lib/http";
import { limit } from "@/lib/security/rate-limit";
import { suggestTimes } from "@/lib/services/calendar";

const Body = z.object({
  panelistIds: z.array(z.string().uuid()).min(1).max(8),
  durationMin: z.number().int().min(15).max(240),
  timeZone: z.string().min(1).max(64),
  days: z.number().int().min(1).max(21).default(10),
  workStartHour: z.number().int().min(0).max(23).default(9),
  workEndHour: z.number().int().min(1).max(24).default(18),
});

/** Times when every connected panelist is free (within working hours in the scheduler's time zone). */
export const POST = handle(async (req: Request) => {
  const user = await requireStaff("recruiter");
  await limit(`cal-suggest:${user.id}`, 60, 3600);
  return json(await suggestTimes(user, Body.parse(await req.json())));
});
