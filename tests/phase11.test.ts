import { describe, expect, it } from "vitest";
import { renderEmail, templateProblems, TEMPLATES, TEMPLATE_KEYS, type TemplateKey } from "@/lib/core/templates";
import { channelPayload, channelUrlProblem, slackEscape } from "@/lib/core/notifications";

const brand = { companyName: "Acme & Co", color: "#0f766e", logoUrl: null };

describe("email templates", () => {
  it("every built-in template is valid", () => {
    for (const k of TEMPLATE_KEYS) expect(templateProblems(k, TEMPLATES[k])).toEqual([]);
  });
  it("rejects unknown and missing placeholders, multi-line subjects and broken tokens", () => {
    expect(templateProblems("invite", { subject: "Hi {{first_name}}", body: "No link here" })).toContain("{{link}} must appear in this email.");
    expect(templateProblems("invite", { subject: "Hi", body: "{{link}} {{salary}}" })).toContain("{{salary}} isn't available in this email.");
    expect(templateProblems("reject", { subject: "a\nb", body: "x" })).toContain("The subject must be a single line.");
    expect(templateProblems("reject", { subject: "a", body: "Hello {{first_name" })).toContain("There's an unfinished {{placeholder}}.");
    expect(templateProblems("panel_cancelled", { subject: "x", body: "{{interview_time}}" })[0]).toMatch(/isn't available/);
  });
  it("escapes values and template text, and turns a lone {{link}} into a button", () => {
    const r = renderEmail("invite", { subject: "Interview at {{company}}", body: "Hi {{first_name}} <b>,\n\n{{link}}\n\nBy {{deadline}}" }, { first_name: '<script>alert(1)</script>', company: "Acme & Co", link: "https://x.example/c/abc", deadline: "Friday" }, brand);
    expect(r.subject).toBe("Interview at Acme & Co");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.html).toContain("&lt;b&gt;");
    expect(r.html).toMatch(/<a href="https:\/\/x\.example\/c\/abc" style="background:#0f766e[^"]*">Start your interview<\/a>/);
    expect(r.html).toContain("Acme &amp; Co");
    expect(r.text).toContain("Start your interview: https://x.example/c/abc");
  });
  it("drops empty optional paragraphs and refuses non-http links", () => {
    const r = renderEmail("adjustment_approved", TEMPLATES.adjustment_approved, { first_name: "Ana", note: "", link: "javascript:alert(1)" }, brand);
    expect(r.html).not.toContain("javascript:");
    expect(r.html).not.toContain("<p style=\"margin:0 0 14px\"></p>");
    expect(r.text).not.toContain("javascript");
  });
  it("uses the logo when the organisation has one", () => {
    const r = renderEmail("offer", TEMPLATES.offer, { first_name: "Ana" }, { ...brand, logoUrl: "https://app.example/api/public/orgs/1/logo?v=1" });
    expect(r.html).toContain('<img src="https://app.example/api/public/orgs/1/logo?v=1" alt="Acme &amp; Co"');
  });
  it("covers every key", () => {
    const keys: TemplateKey[] = ["invite", "reminder", "next_round", "panel_choose", "panel_confirmed", "panel_cancelled", "adjustment_approved", "adjustment_declined", "offer", "reject"];
    expect(TEMPLATE_KEYS.sort()).toEqual(keys.sort());
  });
});

describe("team notifications", () => {
  it("checks channel URLs strictly in production only", () => {
    expect(channelUrlProblem("slack", "https://hooks.slack.com/services/T/B/X", true)).toBeNull();
    expect(channelUrlProblem("slack", "https://evil.example/hook", true)).toMatch(/hooks\.slack\.com/);
    expect(channelUrlProblem("teams", "https://acme.webhook.office.com/webhookb2/x", true)).toBeNull();
    expect(channelUrlProblem("teams", "https://prod-12.westus.logic.azure.com:443/workflows/x", true)).toBeNull();
    expect(channelUrlProblem("teams", "http://acme.webhook.office.com/x", true)).toMatch(/HTTPS/);
    expect(channelUrlProblem("slack", "http://127.0.0.1:4620/hook", false)).toBeNull();
    expect(channelUrlProblem("slack", "ftp://x", false)).toMatch(/https/);
    expect(channelUrlProblem("slack", "not a url", false)).toMatch(/valid/);
  });
  it("builds Slack and Teams payloads", () => {
    const m = { title: "Decision needed", text: "A <candidate> & co", link: "https://app.example/app/candidates/1" };
    const s = channelPayload("slack", m) as { blocks: { text?: { text: string }; elements?: { url: string }[] }[] };
    expect(s.blocks[0].text!.text).toBe("*Decision needed*\nA &lt;candidate&gt; &amp; co");
    expect(s.blocks[1].elements![0].url).toBe(m.link);
    const t = channelPayload("teams", m) as { "@type": string; potentialAction: { targets: { uri: string }[] }[] };
    expect(t["@type"]).toBe("MessageCard");
    expect(t.potentialAction[0].targets[0].uri).toBe(m.link);
    expect(slackEscape("a<b>&")).toBe("a&lt;b&gt;&amp;");
  });
});
