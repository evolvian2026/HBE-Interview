"use client";

import { useEffect } from "react";
import { Button } from "../ui";

export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (autoPrint) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [autoPrint]);
  return <Button onClick={() => window.print()}>Print / Save as PDF</Button>;
}
