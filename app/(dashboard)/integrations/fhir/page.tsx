import type { Metadata } from "next";
import Link from "next/link";

import { ImportPanel } from "@/components/fhir/import-panel";
import { PushPanel } from "@/components/fhir/push-panel";
import { Alert, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { requireClinician } from "@/lib/auth/session";
import { readIntegrationStatus, readSyncFailures } from "@/lib/fhir/status";
import { SEED_MRNS, TAG_SYSTEM } from "@/lib/fhir/systems";
import { toIsoDate } from "@/lib/validation/patient";

import { PageHeading } from "./heading";

export const metadata: Metadata = { title: "National platform" };

/**
 * The integration's control room.
 *
 * One page that answers the three questions a clinician actually has about an
 * external system: is it connected, did our data get there, and what did not.
 * Everything on it is read from local rows rather than from the platform, so
 * it renders in full when the platform is unreachable — which is precisely
 * when someone opens it.
 */

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted">{detail}</p> : null}
    </div>
  );
}

export default async function FhirIntegrationPage() {
  await requireClinician();

  const status = await readIntegrationStatus();
  const failures = status.configured
    ? await readSyncFailures()
    : { patients: [], results: [] };

  const hasFailures =
    failures.patients.length > 0 || failures.results.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading />

      {!status.configured ? (
        <Alert tone="info" title="The integration is not configured">
          <p>
            Set{" "}
            {status.missing.map((name, i) => (
              <span key={name}>
                {i > 0 ? ", " : ""}
                <code>{name}</code>
              </span>
            ))}{" "}
            in the environment to enable it. The rest of PulseTrack works
            without them — nothing on this page is required to enter patients or
            import lab results.
          </p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Connection"
          description="Reads are open to every organisation on this server; writes are not. Everything we create is tagged to us, and only we can change it."
          action={
            status.configured ? (
              <Badge tone="low">Configured</Badge>
            ) : (
              <Badge tone="neutral">Not configured</Badge>
            )
          }
        />
        <dl className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
              Server
            </dt>
            <dd className="text-sm break-all text-ink">
              {status.baseUrl ?? "Not set"}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
              Our organisation tag
            </dt>
            <dd className="text-sm break-all text-ink">
              {status.candidateId ? (
                <>
                  {status.candidateId}
                  <span className="block text-xs text-muted">{TAG_SYSTEM}</span>
                </>
              ) : (
                "Not set"
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
        <Figure
          label="Patients linked"
          value={`${status.push.patientsLinked} / ${status.push.patientsTotal}`}
          detail="created by us on the platform"
        />
        <Figure
          label="Results sent"
          value={`${status.push.resultsPushed} / ${status.push.resultsPushable}`}
          detail="locally-entered results only"
        />
        <Figure
          label="Queued"
          value={status.push.pending}
          detail={
            status.push.pending === 0 ? "everything is up to date" : "waiting to send"
          }
        />
        <Figure
          label="Last sent"
          value={
            status.push.lastSyncedAt ? toIsoDate(status.push.lastSyncedAt) : "—"
          }
          detail={status.push.lastSyncedAt ? undefined : "no push yet"}
        />
        <Figure
          label="Patients imported"
          value={status.pull.patientsImported}
          detail="pulled from the platform"
        />
        <Figure
          label="Results imported"
          value={status.pull.resultsImported}
          detail="charted alongside local data"
        />
      </div>

      <PushPanel
        pending={status.push.pending}
        failed={status.push.failed}
        forbidden={status.push.forbidden}
        disabled={!status.configured}
      />

      <ImportPanel
        mrns={SEED_MRNS}
        disabled={!status.configured}
        alreadyImported={status.pull.resultsImported}
      />

      <Card>
        <CardHeader
          title="Records the platform would not accept"
          description="Kept visible rather than retried silently. A refusal is usually a fact about ownership, not a transient fault."
        />
        {!hasFailures ? (
          <EmptyState
            title="Nothing has been refused"
            description="Every record sent to the national platform so far has been accepted."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  {["Record", "Status", "What the platform said"].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 font-mono text-[10px] tracking-[0.1em] text-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failures.patients.map((patient) => (
                  <tr key={patient.id} className="border-b border-rule last:border-0">
                    <td className="px-5 py-3">
                      <Link
                        href={`/patients/${patient.id}`}
                        className="text-accent hover:underline"
                      >
                        {patient.fullName}
                      </Link>
                      <span className="block text-xs text-muted">
                        Patient · {patient.mrn}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          patient.fhirSyncStatus === "FORBIDDEN"
                            ? "critical"
                            : "moderate"
                        }
                      >
                        {patient.fhirSyncStatus === "FORBIDDEN"
                          ? "Refused"
                          : "Failed"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-2">
                      {patient.fhirLastError ?? "No reason recorded."}
                    </td>
                  </tr>
                ))}

                {failures.results.map((result) => (
                  <tr key={result.id} className="border-b border-rule last:border-0">
                    <td className="px-5 py-3">
                      <Link
                        href={`/patients/${result.patient.id}`}
                        className="text-accent hover:underline"
                      >
                        {result.testName}
                      </Link>
                      <span className="block text-xs text-muted">
                        {toIsoDate(result.collectedDate)} · {result.patient.mrn}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          result.fhirSyncStatus === "FORBIDDEN"
                            ? "critical"
                            : "moderate"
                        }
                      >
                        {result.fhirSyncStatus === "FORBIDDEN"
                          ? "Refused"
                          : "Failed"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-2">
                      {result.fhirLastError ?? "No reason recorded."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
