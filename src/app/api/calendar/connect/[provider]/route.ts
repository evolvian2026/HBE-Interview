import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/staff";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { startConnect } from "@/lib/services/calendar";

/** Start connecting the signed-in person's calendar (OAuth). The state is kept in a short-lived cookie. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ provider: string }> }) => {
  await requireStaff("hiring_manager");
  const { provider } = await params;
  const { state, url } = startConnect(provider);
  (await cookies()).set("hbe_cal_state", `${state}.${provider}`, { httpOnly: true, sameSite: "lax", secure: env.isProduction, path: "/api/calendar", maxAge: 600 });
  return NextResponse.redirect(url);
});
