"use client";

import { useRouter } from "next/navigation";
import { Button } from "../ui";
import { api } from "../api";

export function JobActions({ id }: { id: number }) {
  const router = useRouter();
  const act = async (action: "retry" | "discard") => {
    try {
      await api(`/api/platform/jobs/${id}`, { body: { action } });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <div className="flex gap-1">
      <Button variant="secondary" onClick={() => act("retry")}>
        Retry
      </Button>
      <Button variant="ghost" onClick={() => confirm("Discard this failed job?") && act("discard")}>
        Discard
      </Button>
    </div>
  );
}
