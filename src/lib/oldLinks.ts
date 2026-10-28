import { APRIL } from "@/lib/records";

// An elevator's link code (in every emailed link) never changes, so a link from
// last year's email still finds the elevator. After the yearly reset, the PO and
// safety-test pages refuse it — an old answer must not land in (and skip a step
// of) the new cycle. Pure, so the pages and the server say the same thing.
export const PO_CLOSED = "This link is from an earlier inspection. Please use the link in our latest quote email, or call (405) 213-9779.";
export const MAINT_CLOSED = `This link is from an earlier inspection. Please use the link in our latest email, or call ${APRIL.name} at ${APRIL.phone}.`;
