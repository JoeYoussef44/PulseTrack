import { Card, Skeleton } from "@/components/ui";

import { PageHeading } from "./heading";

/**
 * The integration page runs a dozen counts and, after a push, a network round
 * trip. Without this the nav appears to hang on click.
 *
 * The heading is the real one, not a grey box, so the page announces what it
 * is while it loads — the same behaviour as every other page in the dashboard.
 * Everything below mirrors the real layout, including the **six** figures in a
 * three-column grid: an earlier version drew four in four columns, and the
 * grid visibly reflowed when the content arrived.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading />

      <Card>
        <div className="border-b border-rule px-5 py-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-full max-w-2xl" />
        </div>
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <div>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-4 w-64 max-w-full" />
          </div>
          <div>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-4 w-40" />
            <Skeleton className="mt-1 h-3 w-52 max-w-full" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-16" />
            <Skeleton className="mt-1.5 h-3 w-28" />
          </div>
        ))}
      </div>

      <Card className="px-5 py-5">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-4 h-10 w-full" />
      </Card>
    </div>
  );
}
