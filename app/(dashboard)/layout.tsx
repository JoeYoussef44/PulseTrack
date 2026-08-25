import type { ReactNode } from "react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/mark";
import { BarNav, RailNav } from "@/components/shell/nav";
import { logout } from "@/lib/actions/auth";
import { requireClinician } from "@/lib/auth/session";
import { Badge, Button } from "@/components/ui";

/**
 * Which deployment is serving this page, shown only when it is not production.
 *
 * Two URLs run this app and they look identical: the production domain off
 * `main`, and the preview off `dev`. Without a marker the only way to tell
 * which one you are testing is to read the address bar carefully, and the one
 * mistake that costs real time is fixing something on the wrong one.
 *
 * The commit is included because "is my change deployed yet?" is otherwise
 * answered by guessing. `VERCEL_GIT_COMMIT_SHA` is what is actually running,
 * not what was last pushed.
 *
 * Returns null in production and null locally, so a clinician or an evaluator
 * on the live URL never sees it.
 */
function deploymentLabel(): string | null {
  const env = process.env.VERCEL_ENV;
  if (!env || env === "production") return null;

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const name = env === "preview" ? "Preview" : env;

  return sha ? `${name} · ${sha}` : name;
}

/**
 * Second of the three authorisation layers. Middleware already checked the
 * cookie at the edge; this re-checks server-side on every render, so a
 * misconfigured matcher cannot expose a page. Mutations check again.
 *
 * The frame is the one every clinical product uses: a fixed rail for
 * navigation and a work area that takes the rest of the display. The previous
 * shell centred 1104px of content regardless of the monitor, which spent 408px
 * a side on empty margin at 1920px and left the register, the charts and the
 * trends with nowhere to sit beside each other. Below `lg` the rail becomes the
 * horizontal bar it replaced, because a 232px rail on a 375px phone is most of
 * the screen.
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const clinician = await requireClinician();
  const deployment = deploymentLabel();
  const who = clinician.name || clinician.email;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ------------------------------------------------ rail, lg and up -- */}
      <aside className="hidden shrink-0 bg-deep lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-58 lg:flex-col">
        <div className="flex flex-col gap-1 px-5 pt-6 pb-5">
          <Link href="/dashboard" className="text-white">
            <Wordmark />
          </Link>
          {deployment ? (
            <p className="mt-2 font-mono text-[10px] tracking-[0.08em] text-deep-ink">
              {deployment}
            </p>
          ) : null}
        </div>

        <div className="flex-1 px-3">
          <RailNav />
        </div>

        {/* The clinician sits at the foot of the rail, which is where every
            product this one resembles puts it — and it frees the top right of
            each page for that page's own action. */}
        <div className="flex flex-col gap-2 border-t border-deep-2 px-5 py-4">
          <p className="truncate text-xs text-deep-ink" title={who}>
            {who}
          </p>
          <form action={logout}>
            <Button
              type="submit"
              variant="ghost-dark"
              className="-mx-2 px-2 py-1 text-xs"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* -------------------------------------------------- bar, below lg -- */}
      <header className="border-b border-rule bg-surface lg:hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="text-ink">
            <Wordmark eyebrow={false} />
          </Link>

          {deployment ? <Badge tone="accent">{deployment}</Badge> : null}

          <div className="order-3 w-full sm:order-none sm:w-auto">
            <BarNav />
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{who}</span>
            <form action={logout}>
              <Button type="submit" variant="ghost" className="px-3 py-1.5">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------- work area --- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
