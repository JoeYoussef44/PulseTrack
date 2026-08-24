import Link from "next/link";

/**
 * 404, including the one that matters: `notFound()` from a patient page whose
 * id does not exist.
 *
 * It deliberately says nothing about *why* the record is missing. "No such
 * patient" and "you may not view this patient" must look identical from
 * outside, or the 404 becomes a way to enumerate which ids are real.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
      <p className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
        PulseTrack
      </p>

      <h1 className="text-xl font-semibold tracking-tight text-ink">
        Page not found
      </h1>

      <p className="text-sm text-muted">
        This page does not exist, or the record it referred to is no longer on
        file.
      </p>

      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/dashboard" className="text-accent hover:underline">
          Clinic overview
        </Link>
        <Link href="/patients" className="text-accent hover:underline">
          Patients
        </Link>
      </div>
    </main>
  );
}
