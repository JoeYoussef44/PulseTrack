import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { BrandPanel } from "@/components/auth/brand-panel";
import { Wordmark } from "@/components/brand/mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Two columns from `lg` up: what the product is on the left, the form on the
 * right. Below that the panel drops away and the page is the single centred
 * column it has always been, with the mark and name above the card.
 *
 * `grid-cols-1` is named rather than left to a bare `grid`, because Tailwind's
 * numbered columns are `minmax(0, 1fr)` and a bare grid track is `auto` — which
 * takes its width from the item's min-content and is what dragged a 520px table
 * past the viewport in PR #29.
 */
export default async function LoginPage() {
  // An already-signed-in clinician has no reason to see this page.
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <BrandPanel />

      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* The panel carries the identity above `lg`; below it, this does. */}
          <Wordmark size="lg" className="mb-9 text-ink lg:hidden" />

          <div className="mb-8 flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Sign in
            </h1>
            <p className="text-sm text-ink-2">
              Manage patients, assessments and lab results.
            </p>
          </div>

          <div className="rounded-lg border border-rule bg-surface p-6">
            <LoginForm />
          </div>

          <p className="mt-6 text-xs text-muted">
            Clinician access only. Patients do not have accounts — they receive
            a single-use link by email.
          </p>
        </div>
      </div>
    </main>
  );
}
