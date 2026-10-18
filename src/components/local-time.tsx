"use client";

import { useEffect, useState } from "react";

/** A time shown in the viewer's own time zone (UTC on the server render, replaced after hydration). */
export function LocalTime({ iso, withZone = true }: { iso: string; withZone?: boolean }) {
  const [text, setText] = useState(() => new Date(iso).toUTCString().replace(":00 GMT", " UTC"));
  useEffect(() => {
    const d = new Date(iso);
    setText(d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}) }));
  }, [iso, withZone]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
