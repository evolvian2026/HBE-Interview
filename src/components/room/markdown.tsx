import { Fragment } from "react";

/** Minimal, safe renderer for interviewer messages and problem statements: code fences, inline code, bold, lists, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <div className="prose-sm">
      {blocks.map((b, i) =>
        i % 2 === 1 ? (
          <pre key={i}>{b.replace(/^[a-z]*\n/, "")}</pre>
        ) : (
          <Fragment key={i}>
            {b
              .split(/\n{2,}/)
              .filter((p) => p.trim())
              .map((p, j) => {
                const lines = p.split("\n");
                if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
                  return (
                    <ul key={j}>
                      {lines.map((l, k) => (
                        <li key={k}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={j}>
                    {lines.map((l, k) => (
                      <Fragment key={k}>
                        {k > 0 && <br />}
                        {inline(l)}
                      </Fragment>
                    ))}
                  </p>
                );
              })}
          </Fragment>
        ),
      )}
    </div>
  );
}

function inline(s: string) {
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
