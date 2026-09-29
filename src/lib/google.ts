import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";

// The app's Google robot login. Locally it reads the key file in .secrets/;
// on Vercel it reads the same JSON from an env var (no file on the server).
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

let authInstance: GoogleAuth | null = null;
function auth(): GoogleAuth {
  if (authInstance) return authInstance;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  authInstance = json
    ? new GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES })
    : new GoogleAuth({ keyFile: ".secrets/service-account.json", scopes: SCOPES });
  return authInstance;
}

const DASHBOARD_ID = "1HlV3pkQc0sdwghuzlcMRgC0WAkR-pSBOLDM8xjVP4Ss";
const REPORTS_FOLDER_ID = "17-QkyhTDbDCkfRVU0QfYAiPjUS0cXO8w";

// Drive uploads run as Robert's own account (a service account has no storage
// of its own on a personal Gmail). Uses the one-time sign-in's refresh token —
// from env vars on Vercel, or the local .secrets files in development.
let oauthClient: OAuth2Client | null = null;
function driveOwner(): OAuth2Client {
  if (oauthClient) return oauthClient;
  let clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken =
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN ||
    JSON.parse(readFileSync(".secrets/oauth-token.json", "utf8")).refresh_token;
  if (!clientId || !clientSecret) {
    const conf = JSON.parse(readFileSync(".secrets/oauth-client.json", "utf8"));
    const c = conf.web || conf.installed;
    clientId = c.client_id;
    clientSecret = c.client_secret;
  }
  oauthClient = new OAuth2Client(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  return oauthClient;
}

const SHEET_URL = `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_ID}`;

// One request to the Sheets API. If Google answers "too many requests" (429 —
// the limit is 60 reads a minute) or has a brief server hiccup (5xx), wait and
// try again: 1s, then 2s, then 4s, plus a little randomness — the retry pattern
// Google recommends. Any other error, or a 4th failure, is passed on.
// `repeatable: false` (appends) retries only on 429, which means Google did
// nothing — a 5xx might have half-succeeded, and repeating would add a duplicate row.
async function sheets<T>(opts: { url: string; method?: string; data?: unknown }, repeatable = true): Promise<T> {
  const client = await auth().getClient();
  for (let attempt = 0; ; attempt++) {
    try {
      return (await client.request<T>(opts)).data;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status ?? 0;
      const retryable = status === 429 || (repeatable && status >= 500);
      if (attempt >= 3 || !retryable) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 400));
    }
  }
}

// Every value the app writes goes through here first. Google Sheets treats text
// that starts with = (and sometimes + - @) as a FORMULA — so a customer typing
// "=IMPORTXML(...)" as their PO number could plant a live formula in the
// dashboard. Anything that looks like a formula is stored as plain text instead
// (the leading apostrophe tells Sheets "this is text"; it isn't shown). Plain
// numbers, dates and phone numbers like "-5", "+1 405 555 0100" or "9/29/2026"
// are left alone.
export function safeCell(v: string): string {
  const s = String(v ?? "");
  if (!/^[=+\-@]/.test(s)) return s;
  if (/^[+-]?[\d\s().,/:-]+$/.test(s)) return s; // just a number / phone / date
  return "'" + s;
}

// Read a range; returns rows of string cells.
export async function readRange(range: string): Promise<string[][]> {
  const res = await sheets<{ values?: string[][] }>({ url: `${SHEET_URL}/values/${encodeURIComponent(range)}` });
  return res.values ?? [];
}

// Overwrite a single cell (e.g. "Elevators!Y5") with a value.
export async function writeCell(a1: string, value: string): Promise<void> {
  await sheets({
    url: `${SHEET_URL}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`,
    method: "PUT",
    data: { values: [[safeCell(value)]] },
  });
}

// Overwrite several cells in ONE request: [["Elevators!U5", "Received"], …].
// Cheaper than several writeCell calls and keeps Google's per-minute limit happy.
export async function writeCells(cells: [a1: string, value: string][]): Promise<void> {
  if (!cells.length) return;
  await sheets({
    url: `${SHEET_URL}/values:batchUpdate`,
    method: "POST",
    data: { valueInputOption: "USER_ENTERED", data: cells.map(([range, v]) => ({ range, values: [[safeCell(v)]] })) },
  });
}

// Append a row to the end of a table (e.g. "Elevators!A:R"); returns the sheet
// row number it landed on (parsed from the API's updatedRange), or null.
export async function appendRow(range: string, values: string[]): Promise<number | null> {
  const res = await sheets<{ updates?: { updatedRange?: string } }>({
    url: `${SHEET_URL}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    method: "POST",
    data: { values: [values.map(safeCell)] },
  }, false);
  const m = res.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

// Find a folder by name under a parent, or create it. Runs as Robert (owner).
async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const client = driveOwner();
  const safe = name.replace(/'/g, "\\'");
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents and name='${safe}'`;
  const found = await client.request<{ files: { id: string }[] }>({
    url: `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
  });
  if (found.data.files?.length) return found.data.files[0].id;
  const created = await client.request<{ id: string }>({
    url: "https://www.googleapis.com/drive/v3/files?fields=id",
    method: "POST",
    data: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
  });
  return created.data.id;
}

// Upload any file into the account's own subfolder of the Reports folder.
// Returns the file's shareable link. mimeType defaults to PDF.
export async function uploadFile(
  name: string,
  bytes: Uint8Array,
  mimeType = "application/pdf",
  account?: string,
): Promise<string> {
  const client = driveOwner();
  const parent = account ? await findOrCreateFolder(account, REPORTS_FOLDER_ID) : REPORTS_FOLDER_ID;
  const boundary = "eei" + Date.now().toString(16);
  const meta = JSON.stringify({ name, parents: [parent], mimeType });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(bytes), Buffer.from(tail, "utf8")]);
  const res = await client.request<{ id: string; webViewLink?: string }>({
    url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.data.webViewLink ?? `https://drive.google.com/file/d/${res.data.id}/view`;
}
