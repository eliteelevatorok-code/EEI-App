import { PublicPage } from "@/components/ui";

// Public privacy page. Google asks for one before the app's Google sign-in (used
// to save finished reports to Drive) can leave "testing" mode. Plain words.
export const metadata = { title: "Privacy — Elite Elevator Inspections" };

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy" subtitle="How the EEI Field App handles information.">
      <div className="space-y-4 text-[15px] text-ink-2">
        <p>
          The EEI Field App is used only by Elite Elevator Inspections, LLC (Oklahoma) to schedule, perform, report and
          bill state elevator inspections.
        </p>
        <p>
          <span className="font-semibold text-ink">What we keep:</span> building and elevator details, contact names,
          emails and phone numbers, maintenance company details, safety-test answers, inspection results, PO numbers
          and invoices.
        </p>
        <p>
          <span className="font-semibold text-ink">Who sees it:</span> our own staff; the Oklahoma Department of Labor
          receives inspection reports as the law requires; QuickBooks holds our invoices. We never sell or rent any of
          it.
        </p>
        <p>
          <span className="font-semibold text-ink">Google:</span> the app saves finished inspection reports into our
          own Google Drive. It can only open files it created itself — nothing else in anyone&apos;s Drive.
        </p>
        <p>
          <span className="font-semibold text-ink">Questions or removal:</span> email{" "}
          <a className="text-accent-ink underline" href="mailto:elite.elevator.ok@gmail.com">
            elite.elevator.ok@gmail.com
          </a>{" "}
          or call (405) 213-9779.
        </p>
      </div>
    </PublicPage>
  );
}
