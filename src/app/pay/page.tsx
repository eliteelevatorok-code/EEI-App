import PayForm from "./PayForm";

// Public, login-free page reached from the "Pay your invoice" link in the invoice
// email: /pay?t=<token>. The token (col AH on the dashboard) is the only thing
// that identifies the elevator — no login.
export default async function PayPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  return <PayForm token={typeof t === "string" ? t : ""} />;
}
