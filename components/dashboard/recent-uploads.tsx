import Link from "next/link";

import { Card, CardHeader, EmptyState, cx } from "@/components/ui";
import {
  UPLOAD_WINDOWS,
  type UploadWindow,
} from "@/lib/dashboard/metrics";
import { recentUploads } from "@/lib/labs/service";

/**
 * Recent lab imports, with the brief's required date-range filter.
 *
 * Two decisions worth stating.
 *
 * **The filter scopes this card, not the page.** A dashboard filter would
 * normally sit in one row above everything it affects, so every panel reads the
 * same slice. It cannot here: the completion rate is defined as all-time
 * (D-DASH-2) and the risk distribution is a snapshot of the register, so
 * narrowing them to "last 7 days" would not make them a smaller truth, it would
 * make them a different and misleading one. The filter therefore lives in the
 * header of the only panel it can honestly change, and says so.
 *
 * **It is a set of links, not a select.** The window lands in the URL, so the
 * view is shareable and back works, and the whole thing keeps functioning
 * before any JavaScript loads — which for a clinical tool on a hospital
 * connection is worth more than the animation.
 */
export async function RecentUploads({ window }: { window: UploadWindow }) {
  const uploads = await recentUploads(10, window.since);

  return (
    <Card>
      <CardHeader
        title="Recent lab imports"
        description={
          window.days === null
            ? "All imports, newest first."
            : `Imports from the last ${window.days} days, newest first.`
        }
        action={
          <nav
            aria-label="Filter uploads by date range"
            className="flex flex-wrap gap-1"
          >
            {UPLOAD_WINDOWS.map((option) => {
              const active = option.key === window.key;

              return (
                <Link
                  key={option.key}
                  href={`/dashboard?uploads=${option.key}`}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-ink-2 hover:bg-subtle",
                  )}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
        }
      />

      {uploads.length === 0 ? (
        // "Nothing in this window" and "nothing ever" are different facts and
        // must not share a message — the first has an obvious next action.
        <EmptyState
          title={
            window.days === null
              ? "No imports yet"
              : `No imports in the last ${window.days} days`
          }
          description={
            window.days === null
              ? "Import a lab CSV and it will be listed here with what was accepted, rejected and already on file."
              : "Widen the range to see older imports."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                {["File", "Imported", "Rejected", "Already on file", "When"].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap text-muted uppercase"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.id} className="border-b border-rule last:border-0">
                  {/* The card sits in a column now, so a long filename has to
                      truncate rather than wrap into three lines. The full name
                      stays available on hover and to a screen reader. */}
                  <td
                    className="max-w-[16rem] truncate px-5 py-3 text-ink"
                    title={upload.filename}
                  >
                    {upload.filename}
                  </td>
                  <td className="tabular px-5 py-3 text-band-low">
                    {upload.acceptedCount}
                  </td>
                  <td className="tabular px-5 py-3">
                    {upload.rejectedCount > 0 ? (
                      <span className="text-band-critical">
                        {upload.rejectedCount}
                      </span>
                    ) : (
                      <span className="text-ink-2">0</span>
                    )}
                  </td>
                  <td className="tabular px-5 py-3 text-ink-2">
                    {upload.skippedDuplicateCount}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted">
                    {upload.uploadedAt.toISOString().slice(0, 16).replace("T", " ")}{" "}
                    UTC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
