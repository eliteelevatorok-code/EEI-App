# EEI Field App

The phone app and back-office plumbing for **Elite Elevator Inspections, LLC** (Oklahoma).
It fills out Oklahoma DOL's official third-party inspection form, keeps the customer
dashboard up to date, and gives the Make automation the endpoints it needs to run the
yearly inspection cycle (reminders, quote, scheduling, report, invoice, payment, reset).

Live at **https://eeireports.sbs** — deployed by Vercel on every push to `main`.

## How the pieces fit

| Piece | Where | What it does |
|---|---|---|
| **Dashboard** | Google Sheet (`DASHBOARD_ID` in `src/lib/google.ts`) | The single source of truth. Tabs: **Elevators** (one row per elevator), **Config** (keys + flags), **PushSubs** (phones signed up for alerts), **Emails** (wording notes). |
| **This app** | Next.js, `src/` | Inspector's phone app + public customer pages + endpoints the automation calls. |
| **Automation** | Make.com scenario "EEI – daily lifecycle" (hourly, 8am–7pm) | Walks every row and fires the right email/step at each stage. A second scenario, "EEI – push alerts", pings `/api/push/run` hourly. |
| **Billing** | QuickBooks Online (sandbox until go-live) | Invoices are created and payment is detected via `src/lib/quickbooks.ts`. |

### Elevators tab columns the code relies on
`A` OK # · `B` Building · `E` Account · `F` Contact · `G` Email · `K` Maint. email · `O` Cycle ·
`P` Price · `R` Due · `S`–`AE` lifecycle stages (2-mo email, Quote, PO, Scheduling, Maint. confirm,
Access, Visit, Trip day, Report, Invoice, Follow-ups, Paid, New timer) · `AH` link token ·
`AI`/`AJ` PO # / PO file · `AK` QuickBooks invoice id · `AL` Active (on/off switch) ·
`AM`/`AN` last inspection result/date (from the maintenance form) · `AO` report file link.
The app knows these columns by name in exactly one place, `src/lib/sheet.ts`. If a column moves,
change its number there — and in the Make scenario, which refers to columns by the same
0-based numbers (e.g. `{{100.`37`}}` = AL).

## Folder guide

- `src/app/page.tsx` — the inspector's app: elevator list, profile, report, settings.
- `src/app/{pay,po,maint}/` — public, login-free customer pages opened from email links (`?t=<token>`).
- `src/app/switches/` — master on/off switch (two-step to pause everything).
- `src/app/api/` — server endpoints. The ones the Make automation calls are guarded by
  an `x-scheduler-key: <pushRunSecret>` header (`src/lib/schedulerKey.ts`): `/api/push/run`, `/api/invoice/run`, `/api/switches/master`.
- `src/app/globals.css` — **the style guide**: every color, corner, shadow and motion (tokens) plus the named pieces (`.glass`, `.btn-primary`, `.chip`, `.input`, `.list`, `.sheet`…). Never type a raw color in a component.
- `src/components/ui.tsx` — the style guide as React pieces (Screen, Title, Glass, List, Button, Chips, Toggle, Sheet, PublicPage…). Screens are built from these.
- `src/components/Assistant.tsx` + `src/app/api/assistant/` + `src/lib/assistant/` — the Ask tab: Claude (Robert's own Anthropic key, which he sets himself as the `ANTHROPIC_API_KEY` environment variable in Vercel — the app has no screen or endpoint that accepts a key) with read tools + change tools; every change waits for Confirm in the app.
- `src/lib/` — the logic: `google.ts` (Sheets/Drive), `roster.ts` (reads/writes elevator rows),
  `fillForm.ts` (the state PDF), `invoice.ts` + `quickbooks.ts` (billing), `switches.ts`, `push.ts` (phone alerts).
- `src/proxy.ts` — login wall (Google sign-in via Clerk, limited to 4 approved emails in
  `src/lib/allowlist.ts`) plus the list of public pages.
- `templates/inspection-form.pdf` — Oklahoma DOL's official form that gets filled.
- `scripts/` — small dev/maintenance tools; each file says what it does and how to run it.

## Secrets (never committed)

Local development reads `.secrets/` (Google service-account key, Drive sign-in token).
On Vercel the same values come from environment variables (`GOOGLE_SERVICE_ACCOUNT_JSON`,
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, plus Clerk's keys).
Push-alert keys, the scheduler secret, the master switch, and the QuickBooks keys live in the
dashboard's private **Config** tab.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build check
npm run lint
```
