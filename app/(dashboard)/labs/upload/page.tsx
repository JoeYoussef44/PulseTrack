import type { Metadata } from "next";
import { Suspense } from "react";

import { UploadForm } from "@/components/labs/upload-form";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { requireClinician } from "@/lib/auth/session";
import { recentUploads } from "@/lib/labs/service";

export const metadata: Metadata = { title: "Lab import" };

/** Uploads are an audit trail; they must reflect the database, not a cache. */
export const dynamic = "force-dynamic";

async function RecentUploads() {
  const uploads = await recentUploads();

  if (uploads.length === 0) {
    return (
      <EmptyState
        title="No imports yet"
        description="Once you import a lab CSV it will be listed here with what was accepted, rejected and already on file."
      />
    );
  }

  return (
    // Plain overflow container, no negative margin: the parent Card supplies no
    // horizontal padding, so a -mx-5 here has nothing to cancel and pulls the
    // table 20px outside the card on each side -- breaking the card border and
    // scrolling the whole page sideways at 375px. The -mx-5 in upload-form.tsx
    // is correct because its parent there is a px-5 wrapper.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs text-muted">
            <th scope="col" className="px-5 py-2 font-medium sm:px-5">
              File
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Imported
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Rejected
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Already on file
            </th>
            <th scope="col" className="px-5 py-2 font-medium">
              When
            </th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => (
            <tr key={upload.id} className="border-b border-rule last:border-0">
              <td className="px-5 py-3 text-ink">{upload.filename}</td>
              <td className="px-3 py-3 tabular-nums text-band-low">
                {upload.acceptedCount}
              </td>
              <td className="px-3 py-3 tabular-nums text-ink-2">
                {upload.rejectedCount > 0 ? (
                  <span className="text-band-critical">
                    {upload.rejectedCount}
                  </span>
                ) : (
                  0
                )}
              </td>
              <td className="px-3 py-3 tabular-nums text-ink-2">
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
  );
}

export default async function LabUploadPage() {
  await requireClinician();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lab import"
        description="Import fasting glucose, HbA1c and blood pressure results from a CSV. Re-uploading a corrected file never creates duplicates."
      />

      <UploadForm />

      <Card>
        <CardHeader
          title="Recent imports"
          description="The ten most recent, newest first."
        />
        <Suspense
          fallback={
            <div className="flex flex-col gap-2 px-5 py-5">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-3/5" />
            </div>
          }
        >
          <RecentUploads />
        </Suspense>
      </Card>
    </div>
  );
}
