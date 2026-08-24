"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { PatientFormState } from "@/lib/actions/patients";

export interface PatientFormValues {
  fullName: string;
  mrn: string;
  dateOfBirth: string;
  sex: string;
  email: string;
  phone: string;
}

const SEX_OPTIONS = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
  { value: "UNKNOWN", label: "Unknown" },
];

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function PatientForm({
  action,
  defaults,
  submitLabel,
  cancelHref,
}: {
  action: (
    state: PatientFormState,
    formData: FormData,
  ) => Promise<PatientFormState>;
  defaults?: Partial<PatientFormValues>;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<PatientFormState, FormData>(
    action,
    {},
  );

  const err = (field: string) => state.errors?.[field];

  /**
   * What each input should fall back to. React resets an uncontrolled form once
   * its action resolves, and the reset lands on `defaultValue` — so echoing the
   * rejected submission back through here is what stops a clinician losing all
   * six fields because one of them was wrong.
   */
  const val = (field: keyof PatientFormValues) =>
    state.values?.[field] ?? defaults?.[field];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.message ? <Alert tone="danger">{state.message}</Alert> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Full name" htmlFor="fullName" error={err("fullName")}>
            <Input
              id="fullName"
              name="fullName"
              defaultValue={val("fullName")}
              required
              autoComplete="off"
              invalid={Boolean(err("fullName"))}
            />
          </Field>
        </div>

        <Field
          label="MRN"
          htmlFor="mrn"
          error={err("mrn")}
          hint="Medical record number. Must be unique across the clinic."
        >
          <Input
            id="mrn"
            name="mrn"
            defaultValue={val("mrn")}
            required
            placeholder="MRN-1004"
            autoComplete="off"
            className="font-mono"
            invalid={Boolean(err("mrn"))}
          />
        </Field>

        <Field
          label="Date of birth"
          htmlFor="dateOfBirth"
          error={err("dateOfBirth")}
        >
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={val("dateOfBirth")}
            required
            invalid={Boolean(err("dateOfBirth"))}
          />
        </Field>

        <Field label="Sex" htmlFor="sex" error={err("sex")}>
          {/*
            React applies `defaultValue` to a <select> only when it mounts, so
            unlike the text inputs this one would still reset to "Select…" after
            a rejected submission. Keying it on the echoed value remounts it
            when — and only when — that value actually changes.
          */}
          <Select
            key={val("sex") ?? "unset"}
            id="sex"
            name="sex"
            defaultValue={val("sex") ?? ""}
            required
            invalid={Boolean(err("sex"))}
          >
            <option value="" disabled>
              Select…
            </option>
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          error={err("email")}
          hint="Required to send an assessment."
        >
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={val("email")}
            autoComplete="off"
            invalid={Boolean(err("email"))}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Phone" htmlFor="phone" error={err("phone")}>
            <Input
              id="phone"
              name="phone"
              defaultValue={val("phone")}
              placeholder="+961 3 111 001"
              autoComplete="off"
              invalid={Boolean(err("phone"))}
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-rule pt-5">
        <SubmitButton label={submitLabel} />
        <Link
          href={cancelHref}
          className="text-sm text-muted hover:text-ink"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
