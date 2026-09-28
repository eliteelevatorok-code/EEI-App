import PoForm from "./PoForm";

// Public, login-free page reached from the "Submit your PO number" link in the
// quote email: /po?t=<token>. The token (col AH) is the only thing that identifies
// the elevator — no login.
export default async function PoPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  return <PoForm token={typeof t === "string" ? t : ""} />;
}
