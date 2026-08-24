"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Alert, Button } from "@/components/ui";
import {
  submitPublicAssessment,
  type PublicSubmitState,
} from "@/lib/actions/public-assessment";

interface Option {
  value: number;
  label: string;
}

interface Item {
  id: string;
  text: string;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || disabled} className="w-full sm:w-auto">
      {pending ? "Submitting…" : "Submit assessment"}
    </Button>
  );
}

export function AssessmentForm({
  token,
  items,
  options,
  instructions,
}: {
  token: string;
  items: Item[];
  options: Option[];
  instructions: string;
}) {
  const action = submitPublicAssessment.bind(null, token);
  const [state, formAction] = useActionState<PublicSubmitState, FormData>(
    action,
    {},
  );

  // Tracked purely to guide the patient. It is not the validation — the server
  // re-checks completeness regardless of what the browser allows.
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const remaining = items.length - Object.keys(answered).length;

  if (state.ok) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success-soft">
          <span aria-hidden className="text-lg text-success">
            ✓
          </span>
        </div>
        <h2 className="text-lg font-semibold text-ink">Thank you</h2>
        <p className="text-sm text-ink-2">
          Your answers have been sent to your clinic. There is nothing else you
          need to do — your clinician will review them before your next
          appointment.
        </p>
        <p className="text-xs text-muted">
          You can close this page. The link will not open again.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <p className="text-sm text-ink-2">{instructions}</p>

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <ol className="flex flex-col gap-5">
        {items.map((item, index) => {
          const isMissing = state.missing?.includes(item.id);

          return (
            <li
              key={item.id}
              className={`rounded-lg border p-4 ${
                isMissing ? "border-danger bg-danger-soft" : "border-rule bg-surface"
              }`}
            >
              <fieldset>
                <legend className="mb-3 flex gap-2 text-sm text-ink">
                  <span className="font-mono text-xs text-muted">
                    {index + 1}.
                  </span>
                  <span>{item.text}</span>
                </legend>

                <div className="grid gap-2 sm:grid-cols-2">
                  {options.map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md border border-rule px-3 py-2 text-sm text-ink-2 hover:border-rule-strong hover:bg-subtle has-checked:border-accent has-checked:bg-accent-soft has-checked:text-ink"
                    >
                      <input
                        type="radio"
                        name={item.id}
                        value={option.value}
                        required
                        className="accent-accent"
                        onChange={() =>
                          setAnswered((prev) => ({
                            ...prev,
                            [item.id]: option.value,
                          }))
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted" aria-live="polite">
          {remaining === 0
            ? "All questions answered."
            : `${remaining} of ${items.length} questions remaining.`}
        </p>
        <SubmitButton disabled={false} />
      </div>
    </form>
  );
}
