"use client";

import { useRouter } from "next/navigation";
import { Button } from "../ui";
import { api } from "../api";

export function DataRequestActions({ id }: { id: string }) {
  const router = useRouter();
  const act = async (body: Record<string, string>) => {
    try {
      await api(`/api/data-requests/${id}`, { body });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <div className="flex gap-2">
      <Button variant="danger" onClick={() => confirm("Permanently delete this candidate's data now?") && act({ action: "delete" })}>
        Delete now
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          const reason = prompt("Why can't the data be deleted? (e.g. legal hold, active dispute). The candidate will be told.");
          if (reason && reason.trim().length >= 10) act({ action: "decline", reason });
          else if (reason !== null) alert("Please give a reason of at least 10 characters.");
        }}
      >
        Decline…
      </Button>
    </div>
  );
}
