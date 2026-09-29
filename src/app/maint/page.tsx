import MaintForm from "./MaintForm";

// Public, login-free page reached from the "Answer the two questions" link in
// the safety-test email (sent to American Elevator, or to the customer): /maint?t=<token>.
// The token (col AH) is the only thing that identifies the elevator — no login.
export default async function MaintPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  return <MaintForm token={typeof t === "string" ? t : ""} />;
}
