"use client";

import { useRouter } from "next/navigation";
import { api } from "../api";

export function ReturnHomeButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  return (
    <button
      className="ml-2 font-medium underline"
      onClick={async () => {
        await api("/api/platform/switch", { body: { orgId } });
        router.push("/app/platform");
        router.refresh();
      }}
    >
      Return to your organisation
    </button>
  );
}
