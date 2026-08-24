import type { Metadata } from "next";

import { AssessmentForm } from "@/components/assessments/assessment-form";
import { DSMA8 } from "@/lib/assessments/definition";
import { openAssessment, type AssessmentGateState } from "@/lib/assessments/service";

export const metadata: Metadata = {
  title: "Self-assessment",
  // The URL contains a live credential. Keeping it out of search indexes and
  // out of referrer headers is the difference between a capability link and a
  // published one.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** Rendered fresh every time: an expired link must not be served from a cache. */
export const dynamic = "force-dynamic";

const UNAVAILABLE: Record<
  Exclude<AssessmentGateState, "valid">,
  { title: string; body: string }
> = {
  "not-found": {
    title: "This link is not valid",
    body: "The link may have been copied incompletely. Check the email you received, or contact your clinic for a new one.",
  },
  expired: {
    title: "This link has expired",
    body: "Assessment links are valid for seven days. Contact your clinic and they can send you a new one.",
  },
  completed: {
    title: "This assessment is already complete",
    body: "Your answers were received. There is nothing else you need to do.",
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex flex-col gap-1.5">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
            Diabetes clinic
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            {DSMA8.title}
          </h1>
        </div>
        <div className="rounded-lg border border-rule bg-surface p-5 sm:p-7">
          {children}
        </div>
        <p className="mt-6 text-xs text-muted">
          Your answers go only to your clinic. This page does not ask for a
          password and never will.
        </p>
      </div>
    </main>
  );
}

function Unavailable({
  state,
}: {
  state: Exclude<AssessmentGateState, "valid">;
}) {
  const copy = UNAVAILABLE[state];

  return (
    <Shell>
      <div className="flex flex-col gap-3 py-6 text-center">
        <h2 className="text-base font-semibold text-ink">{copy.title}</h2>
        <p className="mx-auto max-w-sm text-sm text-ink-2">{copy.body}</p>
      </div>
    </Shell>
  );
}

export default async function PublicAssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const gate = await openAssessment(token);

  // Split rather than combined with ||, so the state narrows for the lookup.
  if (gate.state !== "valid") {
    return <Unavailable state={gate.state} />;
  }

  if (!gate.assessment) {
    // Unreachable in practice; treated as an invalid link rather than a crash.
    return <Unavailable state="not-found" />;
  }

  const { patientFirstName, expiresAt } = gate.assessment;

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-1 border-b border-rule pb-5">
        <p className="text-sm font-medium text-ink">
          {patientFirstName ? `Hello ${patientFirstName},` : "Hello,"}
        </p>
        <p className="text-xs text-muted">
          Eight questions, about two minutes. This link works once and expires
          on {expiresAt.toISOString().slice(0, 10)}.
        </p>
      </div>

      <AssessmentForm
        token={token}
        items={DSMA8.items}
        options={DSMA8.options}
        instructions={DSMA8.instructions}
      />
    </Shell>
  );
}
