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

export const DASHBOARD_ID = "1HlV3pkQc0sdwghuzlcMRgC0WAkR-pSBOLDM8xjVP4Ss";
export const REPORTS_FOLDER_ID = "17-QkyhTDbDCkfRVU0QfYAiPjUS0cXO8w";

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

// Read a range; returns rows of string cells.
export async function readRange(range: string): Promise<string[][]> {
  const client = await auth().getClient();
  const res = await client.request<{ values?: string[][] }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_ID}/values/${encodeURIComponent(range)}`,
  });
  return res.data.values ?? [];
}

// Overwrite a single cell (e.g. "Elevators!Y5") with a value.
export async function writeCell(a1: string, value: string): Promise<void> {
  const client = await auth().getClient();
  await client.request({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_ID}/values/${encodeURIComponent(
      a1,
    )}?valueInputOption=USER_ENTERED`,
    method: "PUT",
    data: { values: [[value]] },
  });
}

// Append a row to the end of a table (e.g. "Elevators!A:R"); returns the sheet
// row number it landed on (parsed from the API's updatedRange).
export async function appendRow(range: string, values: string[]): Promise<number | null> {
  const client = await auth().getClient();
  const res = await client.request<{ updates?: { updatedRange?: string } }>({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${DASHBOARD_ID}/values/${encodeURIComponent(
      range,
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    method: "POST",
    data: { values: [values] },
  });
  const m = res.data.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
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

// Upload a PDF (kept for the report flow; delegates to uploadFile).
export async function uploadPdf(name: string, bytes: Uint8Array, account?: string): Promise<string> {
  return uploadFile(name, bytes, "application/pdf", account);
}
