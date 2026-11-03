import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/staff";
import { env } from "@/lib/env";
import { finishConnect } from "@/lib/services/calendar";

const back = (q: string) => NextResponse.redirect(`${env.appBaseUrl.replace(/\/$/, "")}/app/security?${q}#calendar`);

/** The calendar provider sends the person back here with a one-time code. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = jar.get("hbe_cal_state")?.value ?? "";
  jar.delete({ name: "hbe_cal_state", path: "/api/calendar" });
  try {
    const user = await requireStaff("hiring_manager");
    if (url.searchParams.get("error")) return back(`calendar_error=${encodeURIComponent("The calendar provider didn't grant access.")}`);
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || saved !== `${state}.${provider}` || !code) return back(`calendar_error=${encodeURIComponent("That sign-in link expired or didn't match — please try again.")}`);
    await finishConnect(user, provider, code);
    return back("calendar=connected");
  } catch (e) {
    return back(`calendar_error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
