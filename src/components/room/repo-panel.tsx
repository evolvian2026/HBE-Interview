import type { RepoWorkspace } from "@/lib/interview/exercises";

export function RepoPanel({ ws }: { ws: RepoWorkspace }) {
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <p className="text-sm text-slate-600">The interviewer may refer to these files from your repositories.</p>
      {ws.repos.map((r) => (
        <div key={r.projectName} className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-100 px-3 py-2 text-sm">
            <span className="font-medium">{r.projectName}</span>{" "}
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                {r.url.replace(/^https?:\/\/github\.com\//, "")}
              </a>
            )}
          </div>
          <div className="space-y-3 p-3">
            {[...new Map(r.questions.map((q) => [q.filePath, q])).values()].map((q) => (
              <div key={q.filePath}>
                <p className="font-mono text-xs text-slate-500">{q.filePath}</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{q.snippet}</pre>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
