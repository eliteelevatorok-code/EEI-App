# QuickBooks Online — working reference for EEI

Everything we need to build and safely test the QuickBooks piece of the customer
lifecycle. Compiled from Intuit's own developer docs, the legal/security terms, the
2025–2026 App Partner Program announcement, Make's module catalog, and multiple
current developer guides. Sources are listed at the bottom.

---

## 1. The short version (read this first)

- **Cost to us is $0.** Connecting *one* business to *its own* QuickBooks company is
  free. Intuit's new "App Partner Program" has a free **Builder tier** with unlimited
  "Core" API calls (accounting/invoicing is Core) plus 500,000 metered credits a month —
  far more than a one-company inspection business will ever use. The paid tiers ($300 /
  $1,700 / $4,500 a month) are for big software vendors reselling to many customers. Not us.
- **Testing touches zero real money and zero real data.** Intuit gives every developer
  account a free **Sandbox** — a completely separate fake company. Payments there are
  *simulated* with Intuit's test card numbers; nothing is charged, nothing hits a bank.
- **The sandbox is physically walled off from the live account.** Development keys can
  *only* reach the sandbox; production keys can *only* reach the live company. As long as
  the test build uses the development keys, it is impossible for it to touch a real
  customer, a real card, or real money — even by mistake.
- **We almost certainly never handle a card at all.** Charging a card is a *separate*
  Intuit product ("QuickBooks Payments"). Our lifecycle only needs to **create an invoice**
  and **record that it was paid**. That removes the scariest risk before we start.
- **Robert's one job:** create a free Intuit Developer account and connect it (he does the
  login himself; Claude never sees his password or QuickBooks credentials).

---

## 2. Sandbox = the safe test environment

- Free, auto-created with your developer account. Pre-filled with fake customers, items,
  and accounts so you can start immediately. Up to 10 sandbox companies; each lasts ~2 years.
- Base address is different from live, so calls literally go to a different server:
  - **Sandbox:** `https://sandbox-quickbooks.api.intuit.com`
  - **Live/Production:** `https://quickbooks.api.intuit.com`
- **Key rule (the safety guarantee):** *sandbox companies connect only with the app's
  development keys; live companies connect only with production keys.* Test build uses dev
  keys → cannot reach anything real.
- Sandbox **payments are simulated and settle instantly** — you can practice refunds, and
  use special cardholder names like `emulate=10301` to force specific error responses for
  testing. Test Visa number: `4111 1111 1111 1111` (any future expiry / any CVC).
- You can't *reset* sample data, but you can delete everything and start clean. Good enough
  for repeat full-cycle runs.

**So Robert's idea of paying <$5 as the fake companies is not needed** — the sandbox is
free and fake end to end. (If we ever *do* want to test real card charging later, that's the
Payments product in production, and that's the only time real money would be involved.)

---

## 3. Two ways to talk to QuickBooks from Make

Make has a full native QuickBooks app **and** a generic HTTP option. Both are viable.

### Option A — Make's native QuickBooks modules (simplest)
Make offers ready-made actions (no hand-built JSON):
- **Invoice:** Create, Update, Delete, Get, Search, **Download** (PDF), **Send** (emails it)
- **Customer:** Create, Update, Get, Search
- **Item:** Create, Update, Get, Search
- **Payment:** Create, Update, **Watch Payments** (instant trigger), Send, Search
- Also Estimate, SalesReceipt, Bill, PurchaseOrder, CreditMemo, RefundReceipt, Vendor,
  Account, Deposit, JournalEntry, File/Attachment, **New Event** (instant trigger),
  **Get My Company**, and a generic **Make an API Call**.
- The **Create an Invoice** output includes an **InvoiceLink** — a direct payment/pay-online
  URL we could drop into the customer email.

**Catch:** Make's built-in QuickBooks connection is aimed at the *live* (production) service.
To keep testing in the sandbox, turn on "show advanced settings" when creating the
connection and paste **our own developer app's *development* client ID/secret** — that forces
the connection into the sandbox. Flip to production keys only when we go live.

### Option B — Generic HTTP modules to the sandbox base URL (max control)
Same pattern we already use elsewhere in this scenario: an HTTP OAuth2 connection pointed at
`sandbox-quickbooks.api.intuit.com`, sending the JSON below by hand. More work, but total
control over sandbox-vs-live and exact fields.

**Recommendation:** Use Option A (native modules) with **development keys** for all testing.
It's the least dramatic and least error-prone. Keep Option B in our pocket for anything the
native modules can't do (e.g. attaching the PO file, custom fields).

---

## 4. Authentication (OAuth 2.0)

- Standard "authorization code" flow. Robert clicks connect and approves; we get tokens.
- **Scope** for accounting/invoicing: `com.intuit.quickbooks.accounting`.
- Auth URL: `https://appcenter.intuit.com/connect/oauth2` · Token URL:
  `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`.
- **Access token** lasts 60 min. **Refresh token** lasts 100 days and **rotates on every
  refresh** — always store the newest one. If unused for 100 days, Robert must reconnect.
- The **realmId** returned at connect time = the company ID; it goes in every API URL and
  must be saved. (Make handles all of this inside its connection once set up.)

---

## 5. The API basics

- URL shape: `{base}/v3/company/{realmId}/{resource}` — e.g. `.../invoice`, `.../payment`,
  `.../query`, `.../customer/123`.
- **Always append `?minorversion=75`.** As of Aug 1 2025, versions 1–74 are deprecated and
  treated as 75. 75 is current.
- Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`,
  `Accept: application/json`.
- **Rate limits:** 500 requests/min per company; 10 concurrent; batch endpoint 40/min.
  Over the limit → HTTP 429 (error 003001) → back off and retry. We're nowhere near this.

---

## 6. The pieces we actually need, with exact fields

### Customer — create / find
- Create needs only a **unique `DisplayName`**. **Duplicate names fail (error 6240)** — QBO
  won't allow two customers/vendors/employees to share a name. So: search first, create only
  if missing. Cache each customer's `Id` + `DisplayName`.
- Find: `GET /query?query=SELECT * FROM Customer WHERE DisplayName = 'Acme'`.

### Item — the thing being billed (create once)
- An invoice line must point at an **Item**. A **Service** item needs an
  **`IncomeAccountRef`** (which income account the sale posts to).
- We'll create a small set of items up front (e.g. "Elevator Inspection") and reuse them.

### Invoice — create
`POST /invoice?minorversion=75`
```json
{
  "CustomerRef": { "value": "<customer Id>" },
  "DueDate": "2026-07-01",
  "Line": [
    {
      "Amount": 175.00,
      "DetailType": "SalesItemLineDetail",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "<item Id>" },
        "Qty": 1,
        "UnitPrice": 175.00
      }
    }
  ],
  "BillEmail": { "Address": "customer@example.com" }
}
```
- **Required:** `CustomerRef.value`, and at least one `Line` with `Amount` +
  `SalesItemLineDetail.ItemRef.value`.
- **Invoice number** = `DocNumber`. If the company setting "custom transaction numbers" is
  off, **leave DocNumber out** and QBO auto-numbers it. To allow a repeated number, add
  `?include=allowduplicatedocnum`.
- Response returns the new invoice `Id`, `SyncToken`, `TotalAmt`, and `Balance`.

### Send the invoice by email
- Native Make **Send an Invoice** module, or `POST /invoice/<id>/send?sendTo=email@x.com`.
- PDF copy: **Download an Invoice** module, or `GET /invoice/<id>/pdf`.

### Record a payment against an invoice
`POST /payment?minorversion=75`
```json
{
  "CustomerRef": { "value": "<customer Id>" },
  "TotalAmt": 175.00,
  "Line": [
    {
      "Amount": 175.00,
      "LinkedTxn": [ { "TxnId": "<invoice Id>", "TxnType": "Invoice" } ]
    }
  ]
}
```
- **`TxnId` is the invoice's internal `Id`, NOT the invoice number (`DocNumber`).**
- After this, the invoice's **`Balance` goes to 0** = fully paid. One payment can cover
  several invoices.

### Detect paid vs unpaid (no dedicated "status" field)
- **`Balance == 0` → paid; `Balance > 0` → open.**
- Unpaid: `SELECT * FROM Invoice WHERE Balance > '0' ORDER BY DueDate`.
- Overdue: `SELECT * FROM Invoice WHERE DueDate < '<today>' AND Balance > '0'`.

### Attach the customer's PO file (optional, ties into our PO capture)
- Upload via the **Attachable** endpoint (multipart) with `AttachableRef.EntityRef` =
  `{ "type": "Invoice", "value": "<invoice Id>" }`. Native Make "File/Attachment: Upload".
- The **PO number** itself can go in a **CustomField** on the invoice, or the invoice
  memo/`DocNumber` — CustomField needs a `DefinitionId` from the company's sales-form prefs
  (QBO supports only the first 3 string custom fields on sales forms).

---

## 7. Editing / voiding / deleting (know the difference)

- **Every update requires the current `SyncToken`.** QBO uses "optimistic locking": get the
  object, read its `SyncToken`, send it back with your change. A stale token → **error 5010
  "Stale Object"**. Fix = re-GET, then update. Pattern: always fetch immediately before you
  write.
- **Sparse update:** send only the fields you're changing plus `Id`, `SyncToken`, and
  `"sparse": true`. Without `sparse`, a full update **nulls out any field you didn't send** —
  dangerous, so prefer sparse.
- **Void** an invoice → it stays in QBO but amounts become 0 (still visible/API-readable).
- **Delete** an invoice → gone, no longer available via API. Prefer void for an audit trail.

---

## 8. Staying in sync (two options)

- **Webhooks (push):** register our endpoint in the developer portal, pick entities/events
  (create/update/delete/void/merge on Invoice, Payment, Customer, etc.). Intuit POSTs us a
  tiny payload with just entity type + ID + company — we then fetch the full record.
  **Verify the `intuit-signature` header (HMAC-SHA256 with the portal's verifier token)** to
  reject spoofed calls.
- **Change Data Capture (poll):** `GET /cdc?entities=Invoice,Payment&changedSince=<time>`
  returns only what changed since a timestamp (look back up to 30 days). Cheaper than
  re-reading everything. Good fit for our hourly Make run.

---

## 9. Taxes (US automated sales tax)

- New US companies use **Automated Sales Tax (AST)** — QBO computes tax from addresses.
- To signal "apply AST," include a `TxnTaxDetail` with `TxnTaxCodeRef` on the invoice.
- Override the amount with `TxnTaxDetail.TotalTax` if needed. (Inspections may be
  non-taxable services — confirm with Robert before enabling tax.)

---

## 10. Going live later (production)

- Getting production keys is free but requires: fill in app details + complete Intuit's
  **App Assessment Questionnaire** (a self-assessment about the app and its data use).
  Turnaround is quick for a private, single-company app; a full marketplace listing (which we
  do NOT need) adds security/marketing reviews.
- **Security expectations:** TLS 1.2+, encrypt tokens/secrets at rest, never hard-code the
  client secret, don't store data you don't need. We already keep secrets out of source.
- Legal/data terms: don't use Intuit data to train AI, don't scrape/archive beyond the app's
  purpose, limit who can see the data.

---

## 11. Fees, only if we ever turn on real card payments (future, optional)

- QuickBooks **Payments** (actual card/ACH processing) is separate and needs its own
  approved merchant account. Typical 2026 rates: ~2.99% cards, ~1% ACH, 3.4–3.5% keyed.
- A QuickBooks Online **subscription** is separate from the API and is Robert's existing
  accounting plan (Simple Start ~$38/mo and up). The API itself doesn't require a specific
  tier for invoicing.
- None of this is needed for the create-invoice + record-payment lifecycle in the sandbox.

---

## 12. How this maps to the EEI lifecycle

Current sheet flow ends with: quote → PO → **invoice** → payment follow-up → paid → reset.
QuickBooks slots in at the invoice + payment steps:

1. **When the row hits "send the invoice":** find-or-create the Customer (by building/account
   name), ensure the "Elevator Inspection" Item exists, **Create an Invoice** for the amount
   (State Charge from the rate card), put the captured **PO number** in a custom field/memo,
   optionally attach the PO file, then **Send** it to the customer email. Save the returned
   invoice `Id` back into the sheet.
2. **Each hourly run:** check that invoice's `Balance`. `Balance == 0` → mark the row Paid and
   trigger the reset. `Balance > 0` past due date → that's a "chase payment" alert (ties into
   the push notifications already built).
3. **Optional:** the **Watch Payments** instant trigger can flip the row to Paid the moment a
   payment is recorded, instead of waiting for the hourly poll.

All of the above gets built and run entirely in the **sandbox with development keys** first.

---

## Sources
- Intuit — Manage sandboxes: https://developer.intuit.com/app/developer/qbpayments/docs/develop/sandboxes/manage-your-sandboxes
- Intuit — Test payments with mock data: https://developer.intuit.com/app/developer/qbpayments/docs/workflows/test-your-app
- Intuit — App Partner Program (fees): https://help.developer.intuit.com/s/article/platform-service-fees ; announcement https://blogs.intuit.com/2025/05/15/introducing-the-intuit-app-partner-program/
- Intuit — Security requirements: https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/security-requirements
- Intuit — Developer terms: https://developer.intuit.com/app/developer/qbo/docs/legal-agreements
- Intuit — Minor versions: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/minor-versions
- Intuit — Manage linked transactions (payments): https://developer.intuit.com/app/developer/qbo/docs/workflows/manage-linked-transactions
- Intuit — Automated Sales Tax: https://blogs.intuit.com/2017/12/11/using-quickbooks-online-api-automated-sales-tax/
- Intuit — Error 5010 (stale object): https://help.developer.intuit.com/s/article/5010-Stale-Object-Error
- Intuit — Custom Fields API: https://blogs.intuit.com/2025/12/01/custom-fields-api-extending-quickbooks-online-with-flexible-metadata/
- Make — QuickBooks app & modules: https://apps.make.com/quickbooks and https://apps.make.com/quickbooks-modules
- Make — pricing/operations: https://zapier.com/blog/make-com-pricing/
- Developer guides (2026): https://satvasolutions.com/blog/quickbooks-online-api-guide ; https://www.getknit.dev/blog/quickbooks-online-api-integration-guide-in-depth ; https://dev.to/zuplo/quickbooks-api-complete-developers-guide-2026-3l77 ; https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide/
- Create a private (single-company) app: https://docs.mydbsync.com/cloud-workflow/connectors/quickbooks-online/steps-to-create-a-private-quickbooks-online-qbo-app-on-intuit-developer-portal
- Void vs delete invoice: https://help-qbo.breadwinner.com/support/solutions/articles/44001765744
