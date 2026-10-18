"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Compact "Admin" menu in the staff header; closes after navigating or clicking elsewhere. */
export function AdminMenu({ items }: { items: { href: string; label: string }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const active = items.some((i) => path.startsWith(i.href));
  return (
    <details ref={ref} className="relative">
      <summary className={`cursor-pointer list-none whitespace-nowrap rounded-md px-2.5 py-1.5 hover:bg-slate-100 ${active ? "font-medium text-slate-900" : "text-slate-700"}`}>Admin ▾</summary>
      <div className="absolute left-0 z-30 mt-1 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100">
            {i.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
