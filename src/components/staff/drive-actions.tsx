"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "../ui";
import { api } from "../api";

export function DriveActions({ driveId, status, published }: { driveId: string; status: string; published: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(s: "active" | "paused" | "closed") {
    if (s === "closed" && !confirm("Close this drive? New candidates won't be able to start; in-progress rounds can finish.")) return;
    setBusy(true);
    try {
      await api(`/api/drives/${driveId}/status`, { body: { status: s } });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!published) return null;
  return (
    <>
      {status === "active" && (
        <Button variant="secondary" disabled={busy} onClick={() => set("paused")}>
          Pause
        </Button>
      )}
      {(status === "paused" || status === "closed") && (
        <Button disabled={busy} onClick={() => set("active")}>
          Activate
        </Button>
      )}
      {status !== "closed" && (
        <Button variant="ghost" disabled={busy} onClick={() => set("closed")}>
          Close
        </Button>
      )}
    </>
  );
}
