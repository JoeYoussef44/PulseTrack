import type { ReactNode } from "react";
import Link from "next/link";

import { logout } from "@/lib/actions/auth";
import { requireClinician } from "@/lib/auth/session";
import { Button } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Clinic" },
  { href: "/patients", label: "Patients" },
  { href: "/labs/upload", label: "Lab import" },
  { href: "/integrations/fhir", label: "National platform" },
];

/**
 * Second of the three authorisation layers. Middleware already checked the
 * cookie at the edge; this re-checks server-side on every render, so a
 * misconfigured matcher cannot expose a page. Mutations check again.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const clinician = await requireClinician();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-tight text-ink"
          >
            PulseTrack
          </Link>

          <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-ink-2 hover:bg-subtle hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">
              {clinician.name || clinician.email}
            </span>
            <form action={logout}>
              <Button type="submit" variant="ghost" className="px-3 py-1.5">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
