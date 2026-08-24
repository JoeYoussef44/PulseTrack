import { Card, Skeleton } from "@/components/ui";

/**
 * The integration page runs a dozen counts and, after a push, a network round
 * trip. Without this the nav appears to hang on click.
 *
 * The skeleton mirrors the real layout — connection card, four figures, the
 * push panel — so the page does not jump when the content arrives.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <Card className="px-5 py-5">
        <Skeleton className="h-4 w-32" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2 h-7 w-16" />
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
