"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";

/**
 * The dashboard's navigation, in the two shapes the shell needs.
 *
 * One list, two presentations: a vertical rail from `lg` up, and the previous
 * horizontal bar below it. Keeping both here means a new destination is added
 * once and appears in both, rather than in one and silently not the other.
 *
 * It is a client component only because the active item depends on the current
 * path. Everything else in the shell stays on the server.
 */

const NAV = [
  { href: "/dashboard", label: "Clinic" },
  { href: "/patients", label: "Patients" },
  { href: "/labs/upload", label: "Lab import" },
  { href: "/integrations/fhir", label: "National platform" },
] as const;

/**
 * `/patients/abc123` is still "Patients", so a prefix match is right — but only
 * on a segment boundary. A bare `startsWith` would light up "Lab import" for a
 * hypothetical `/labs/uploads-archive`.
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function RailNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-deep-2 font-medium text-white"
                : "text-deep-ink hover:bg-deep-2 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BarNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="-mx-1 flex w-full flex-wrap gap-1 sm:mx-0 sm:w-auto sm:flex-nowrap"
    >
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-subtle font-medium text-ink"
                : "text-ink-2 hover:bg-subtle hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
