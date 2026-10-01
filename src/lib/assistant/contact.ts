// The link behind a contact button in the assistant chat: tel:, sms: or
// mailto:, with the message filled in. Used by the server (to check it before
// the button is shown) and by the app (Assistant.tsx draws the button).
// Throws a plain message if the number or address cannot work.
export function contactHref(input: Record<string, unknown>): string {
  const how = String(input.how ?? "");
  const to = String(input.to ?? "").trim();
  const message = String(input.message ?? "").slice(0, 2000);
  if (how === "call" || how === "text") {
    const digits = to.replace(/[^0-9]/g, "");
    const n = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (n.length !== 10) throw new Error(`"${to}" isn't a full 10-digit phone number.`);
    if (how === "call") return `tel:+1${n}`;
    return `sms:+1${n}${message ? `?body=${encodeURIComponent(message)}` : ""}`;
  }
  if (how === "email") {
    if (!/^[^\s@<>?&#]+@[^\s@<>?&#]+\.[^\s@<>?&#]+$/.test(to)) throw new Error(`"${to}" isn't an email address.`);
    const q = [
      input.subject ? `subject=${encodeURIComponent(String(input.subject).slice(0, 200))}` : "",
      message ? `body=${encodeURIComponent(message)}` : "",
    ].filter(Boolean);
    return `mailto:${to}${q.length ? "?" + q.join("&") : ""}`;
  }
  throw new Error("how must be call, text or email.");
}
