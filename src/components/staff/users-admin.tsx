"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Select } from "../ui";
import { api } from "../api";

type Role = "admin" | "recruiter" | "hiring_manager" | "viewer";

export function UsersAdmin({ users, meId }: { users: { id: string; name: string; email: string; role: Role; active: boolean }[]; meId: string }) {
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
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2">{u.name}</td>
              <td>{u.email}</td>
              <td>
                <Select className="w-40" value={u.role} disabled={u.id === meId} onChange={(e) => update(u.id, { role: e.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="recruiter">Recruiter</option>
                  <option value="hiring_manager">Hiring manager</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </td>
              <td>
                <Badge tone={u.active ? "green" : "slate"}>{u.active ? "active" : "inactive"}</Badge>
              </td>
              <td className="text-right">
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
        <Input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input placeholder="Temporary password (8+)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
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
