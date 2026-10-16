"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Textarea } from "../ui";
import { api } from "../api";

export function NotesForm({ candidacyId }: { candidacyId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for the hiring team" />
      <Button
        variant="secondary"
        disabled={!text.trim()}
        onClick={async () => {
          await api(`/api/candidacies/${candidacyId}/notes`, { body: { text } });
          setText("");
          router.refresh();
        }}
      >
        Add note
      </Button>
    </div>
  );
}
