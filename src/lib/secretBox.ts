import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// Encrypts the QuickBooks sign-in (refresh token + company id) before it's saved
// in the dashboard's Config tab, as Intuit's security rules require (AES, with
// the key kept apart from the stored data). Since 2026-10-28 the other secrets
// in Config are scrambled the same way (see SECRET in config.ts).
//
// The key is derived from the app's Google robot private key — already a secret
// on the server (GOOGLE_SERVICE_ACCOUNT_JSON) and on this computer
// (.secrets/service-account.json), and never in the dashboard. Same robot →
// same key in both places. AES-256-GCM, so a tampered value fails to open.
//
// Stored form: "enc:v1:" + base64(iv | tag | ciphertext). Values saved before
// encryption existed (plain text) are still read, and get encrypted the next
// time they're saved.

const PREFIX = "enc:v1:";
let key: Buffer | null = null;

function boxKey(): Buffer {
  if (key) return key;
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? readFileSync(".secrets/service-account.json", "utf8");
  const pk = (JSON.parse(json) as { private_key?: string }).private_key;
  if (!pk) throw new Error("The app's Google robot key is missing — can't open the QuickBooks sign-in");
  key = Buffer.from(hkdfSync("sha256", Buffer.from(pk), Buffer.alloc(0), Buffer.from("eei-quickbooks-tokens-v1"), 32));
  return key;
}

export function seal(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", boxKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

// Throws if the value was encrypted with a different key or was altered.
export function unseal(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // saved before encryption existed
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", boxKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export const isSealed = (stored: string) => stored.startsWith(PREFIX);
