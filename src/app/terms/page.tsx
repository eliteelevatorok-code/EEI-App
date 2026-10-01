import { PublicPage } from "@/components/ui";

// Public end-user license agreement. Intuit asks for one (with the privacy page)
// before it releases the production QuickBooks keys. Plain words.
export const metadata = { title: "Terms of use — Elite Elevator Inspections" };

export default function TermsPage() {
  return (
    <PublicPage title="Terms of use" subtitle="End-user license agreement for the EEI Field App.">
      <div className="space-y-4 text-[15px] text-ink-2">
        <p>
          The EEI Field App is private software owned by Elite Elevator Inspections, LLC (Oklahoma). It is used only by
          Elite Elevator Inspections and the people it invites, to schedule, perform, report and bill state elevator
          inspections. It is not sold or offered to the public.
        </p>
        <p>
          <span className="font-semibold text-ink">Use:</span> invited users may use the app only for Elite Elevator
          Inspections&apos; business. Customers and maintenance companies may use the forms linked from our emails (PO,
          safety-test answer, payment) only for their own elevators.
        </p>
        <p>
          <span className="font-semibold text-ink">QuickBooks:</span> the app connects to our own QuickBooks Online
          company only, to create and send our invoices and check whether they are paid. The connection can be removed
          at any time from QuickBooks.
        </p>
        <p>
          <span className="font-semibold text-ink">No warranty:</span> the app is provided as is. Elite Elevator
          Inspections is not liable for any loss from its use beyond what Oklahoma law requires.
        </p>
        <p>
          <span className="font-semibold text-ink">Privacy:</span> see{" "}
          <a className="text-accent-ink underline" href="/privacy">
            our privacy page
          </a>
          .
        </p>
        <p>
          <span className="font-semibold text-ink">Questions:</span> email{" "}
          <a className="text-accent-ink underline" href="mailto:elite.elevator.ok@gmail.com">
            elite.elevator.ok@gmail.com
          </a>{" "}
          or call (405) 213-9779.
        </p>
      </div>
    </PublicPage>
  );
}
