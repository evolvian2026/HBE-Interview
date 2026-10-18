"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Select } from "../ui";
import { api } from "../api";

type Role = "admin" | "recruiter" | "hiring_manager" | "viewer";

export function UsersAdmin({
  users,
  drives,
  meId,
}: {
  users: { id: string; name: string; email: string; role: Role; active: boolean; driveIds: string[]; platformAdmin?: boolean; has2fa?: boolean; scim?: "managed" | "deprovisioned" }[];
  drives: { id: string; title: string }[];
  meId: string;
}) {
  const router = useRouter();
  const [f, setF] = useState({ name: "", email: "", password: "", role: "recruiter" as Role });
  const [error, setError] = useState("");
  const update = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/settings/users/${id}`, { method: "PUT", body });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <Card title="Users">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2">Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Assigned drives</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2">
                {u.name} {u.platformAdmin && <Badge tone="blue">platform admin</Badge>} {u.scim && <Badge tone={u.scim === "managed" ? "slate" : "amber"}>{u.scim === "managed" ? "SCIM" : "deprovisioned (SCIM)"}</Badge>}
              </td>
              <td>{u.email}</td>
              <td>
                <Select className="w-40" aria-label={`Role of ${u.name}`} value={u.role} disabled={u.id === meId} onChange={(e) => update(u.id, { role: e.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="recruiter">Recruiter</option>
                  <option value="hiring_manager">Hiring manager</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </td>
              <td className="py-2">
                {u.role === "hiring_manager" ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-brand-700">{u.driveIds.length} of {drives.length} drives</summary>
                    <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">
                      {drives.map((d) => (
                        <label key={d.id} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={u.driveIds.includes(d.id)}
                            onChange={(e) => update(u.id, { driveIds: e.target.checked ? [...u.driveIds, d.id] : u.driveIds.filter((x) => x !== d.id) })}
                          />
                          {d.title}
                        </label>
                      ))}
                    </div>
                  </details>
                ) : (
                  <span className="text-xs text-slate-500">All</span>
                )}
              </td>
              <td>
                <Badge tone={u.active ? "green" : "slate"}>{u.active ? "active" : "inactive"}</Badge>{" "}
                <Badge tone={u.has2fa ? "green" : "slate"}>{u.has2fa ? "2FA on" : "2FA off"}</Badge>
              </td>
              <td className="text-right">
                {u.id !== meId && u.has2fa && (
                  <Button variant="ghost" onClick={() => confirm(`Reset ${u.name}'s two-factor sign-in (lost phone)? They'll be signed out and set it up again.`) && update(u.id, { reset2fa: true })}>
                    Reset 2FA
                  </Button>
                )}
                {u.id !== meId && (
                  <Button variant="ghost" onClick={() => update(u.id, { active: !u.active })}>
                    {u.active ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        <Input placeholder="Name" aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Email" aria-label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input placeholder="Temporary password (10+)" aria-label="Temporary password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Select aria-label="Role for the new user" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
          <option value="recruiter">Recruiter</option>
          <option value="hiring_manager">Hiring manager</option>
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </Select>
        <Button
          onClick={async () => {
            setError("");
            try {
              await api("/api/settings/users", { body: f });
              setF({ name: "", email: "", password: "", role: "recruiter" });
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Add user
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
