"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui";
import { deletePatient } from "@/lib/actions/patients";

function ConfirmButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? "Deleting…" : "Yes, delete permanently"}
    </Button>
  );
}

/**
 * Deletion is permanent and cascades to assessments and lab results, so it
 * asks first. It also cannot be undone on the national platform — that server
 * disables DELETE — which the confirmation says plainly rather than hiding.
 */
export function DeletePatient({
  patientId,
  patientName,
  isOnFhir,
}: {
  patientId: string;
  patientName: string;
  isOnFhir: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger-soft p-4">
      <p className="text-sm text-ink">
        Delete <strong>{patientName}</strong>? This also removes their lab
        results and assessment history, and cannot be undone.
      </p>
      {isOnFhir ? (
        <p className="text-xs text-ink-2">
          The record already pushed to the national platform will remain there —
          that server does not permit deletion.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <form action={deletePatient.bind(null, patientId)}>
          <ConfirmButton />
        </form>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
