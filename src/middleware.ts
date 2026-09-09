import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAllowed } from "@/lib/allowlist";

// Public routes that never require sign-in. The PO submission page and its API
// are public on purpose: customers open them from a link in the quote email
// (a random per-elevator token in the URL is what authorizes them), never signed in.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/not-authorized", "/po(.*)", "/api/po(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  const { sessionClaims } = await auth.protect();

  // Free app-side allowlist: block signed-in users whose email isn't approved.
  // Only ever blocks when the email claim is present AND the ALLOWLIST_EMAILS
  // list is configured AND the email isn't on it (see src/lib/allowlist.ts),
  // so it can't lock anyone out before it's set up.
  const email = (sessionClaims as { email?: string } | null)?.email;
  if (email && !isAllowed(email)) {
    return NextResponse.redirect(new URL("/not-authorized", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
