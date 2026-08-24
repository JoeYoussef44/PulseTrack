import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // An already-signed-in clinician has no reason to see this page.
  const session = await auth();
  if (session?.user?.id) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            Diabetes clinic
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            PulseTrack
          </h1>
          <p className="text-sm text-ink-2">
            Sign in to manage patients, assessments and lab results.
          </p>
        </div>

        <div className="rounded-lg border border-rule bg-surface p-6">
          <LoginForm />
        </div>

        <p className="mt-6 text-xs text-muted">
          Clinician access only. Patients do not have accounts — they receive a
          single-use link by email.
        </p>
      </div>
    </main>
  );
}
