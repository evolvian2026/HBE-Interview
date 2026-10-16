# HBE Interview — Integration API & Webhooks

Version 1 · Phase 3

This is the integration surface for an ATS, HRIS or internal tooling. It has two halves:

- **REST API** (`/api/v1/…`) — authenticated with an API key; read drives and candidates, invite candidates.
- **Webhooks** — HBE Interview POSTs signed JSON to your endpoint when something happens.

Both are managed by an **admin** under **Settings → Integrations**. Keys and webhooks belong to one organisation: a key only sees that organisation's drives and candidates, and a webhook only receives that organisation's events. A suspended organisation's keys are refused with `403`.

---

## 1. API keys

Create a key in Settings → Integrations, choosing its scopes. The full key (`hbe_…`) is shown **once**; only its SHA-256 hash is stored. Revoking a key takes effect immediately.

| Scope | Allows |
|---|---|
| `drives:read` | `GET /api/v1/drives` |
| `candidates:read` | `GET /api/v1/drives/{id}/candidates`, `GET /api/v1/candidates/{id}` |
| `candidates:write` | `POST /api/v1/drives/{id}/candidates` (sends invite emails) |

Send the key as a bearer token:

```http
Authorization: Bearer hbe_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Errors are JSON: `{"error": {"message": "…"}}` with `401` (missing/invalid/revoked key), `403` (key lacks the scope), `400` (validation; `details` lists the issues), `404`.

## 2. Endpoints

### `GET /api/v1/drives`

```json
{ "data": [ { "id": "uuid", "title": "Senior Backend Engineer", "status": "active", "openSlug": "k3j…", "createdAt": "2026-10-01T09:00:00.000Z" } ] }
```

`status` is one of `draft | active | paused | closed`. Only `active` drives accept invites.

### `GET /api/v1/drives/{driveId}/candidates`

```json
{ "data": [ {
  "id": "candidacy-uuid", "name": "Asha Rao", "email": "asha@example.com",
  "stage": "gate_pending", "finalStatus": null,
  "finalScore": 72, "recommendation": "hire",
  "createdAt": "…", "updatedAt": "…"
} ] }
```

`finalScore`/`recommendation` are `null` until the combined report is ready.

### `POST /api/v1/drives/{driveId}/candidates`

Invite up to 200 candidates. Re-inviting an existing email is idempotent (`already_invited`, same link).

```json
{ "candidates": [ { "name": "Asha Rao", "email": "asha@example.com" } ] }
```

Response `201`:

```json
{ "data": [ { "name": "Asha Rao", "email": "asha@example.com", "status": "invited",
              "candidacyId": "uuid", "link": "https://interview.example.com/c/<token>" } ] }
```

`status` is `invited | already_invited | invalid`. The `link` is the candidate's personal bearer link — treat it as a secret.

### `GET /api/v1/candidates/{candidacyId}`

```json
{ "data": {
  "id": "uuid", "driveId": "uuid", "driveVersion": 3,
  "candidate": { "name": "Asha Rao", "email": "asha@example.com" },
  "stage": "completed", "finalStatus": "shortlisted",
  "rounds": [
    { "index": 0, "type": "technical", "status": "completed",
      "report": { "status": "ready", "score": 76, "recommendation": "hire", "confidence": "high", "summary": "…" } }
  ],
  "gates": [ { "fromRoundIndex": 0, "decision": "advance", "mode": "auto", "at": "…" } ],
  "result": { "finalScore": 72, "recommendation": "hire", "confidence": "medium", "partial": false },
  "createdAt": "…", "updatedAt": "…"
} }
```

Round `status`: `locked | available | in_progress | completed | under_review | expired`. Round and final scores are 0–100 (weighted from 1–5 rubric parameters); `recommendation` is `strong_hire | hire | lean_no | no_hire`. Evidence quotes, transcripts and integrity detail are **not** exposed through the API — use the staff app or a share link.

## 3. Webhooks

Register an HTTPS endpoint and choose events. The signing secret (`whsec_…`) is shown **once**.

| Event | When | `data` |
|---|---|---|
| `candidate.invited` | A candidacy is created (invite, CSV, API or open link) | `candidacyId`, `driveId`, `candidate {name, email}` |
| `round.completed` | A round session ends | `candidacyId`, `driveId`, `roundIndex`, `roundType`, `endReason` |
| `round.evaluated` | A round report is ready | `candidacyId`, `driveId`, `roundIndex`, `roundType`, `score`, `recommendation`, `confidence` |
| `gate.decided` | An auto or manual gate decision is recorded | `candidacyId`, `fromRoundIndex`, `decision`, `mode` |
| `candidate.completed` | The combined report is ready | `candidacyId`, `finalScore`, `recommendation`, `partial` |
| `candidate.status_changed` | A recruiter shortlists / rejects / holds / completes | `candidacyId`, `status` |
| `ping` | "Send test" in Settings | `message` |

### Request

```http
POST /your/endpoint
content-type: application/json
user-agent: HBE-Interview-Webhooks/1
x-hbe-event: round.evaluated
x-hbe-delivery: 6f1c…            (unique per delivery — use it to de-duplicate)
x-hbe-timestamp: 1760601600      (unix seconds)
x-hbe-signature: sha256=9b2e…

{"id":"6f1c…","event":"round.evaluated","createdAt":"2026-10-16T08:00:00.000Z","data":{…}}
```

### Verifying the signature

`x-hbe-signature` is `sha256=` + hex HMAC-SHA256 of **`{timestamp}.{raw body}`** keyed with the webhook secret. Verify against the raw bytes before parsing JSON, compare in constant time, and reject timestamps more than 5 minutes old to block replays.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHbeWebhook(rawBody: string, headers: Headers, secret: string): boolean {
  const ts = headers.get("x-hbe-timestamp") ?? "";
  const sig = headers.get("x-hbe-signature") ?? "";
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

```python
import hmac, hashlib, time

def verify_hbe_webhook(raw_body: bytes, headers, secret: str) -> bool:
    ts = headers.get("x-hbe-timestamp", "")
    sig = headers.get("x-hbe-signature", "")
    if not ts or abs(time.time() - int(ts)) > 300:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)
```

### Delivery semantics

- **At-least-once.** Respond `2xx` within 10 s. Any other status, a timeout or a network error is retried with exponential back-off, up to 6 attempts, after which the delivery is marked `failed`. Redirects are not followed.
- **Ordering is not guaranteed** — use `createdAt` and re-fetch `GET /api/v1/candidates/{id}` when you need current state.
- **De-duplicate** on `x-hbe-delivery`.
- Pausing a webhook stops new deliveries (queued ones are dropped); deleting it removes its history.
- Settings shows the 15 most recent deliveries with status, attempts and response code.
- In production, endpoints must be HTTPS and may not resolve to private, loopback, link-local or metadata addresses (checked when saved and again at send time).
