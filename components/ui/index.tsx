import type { ComponentProps, ReactNode } from "react";

/**
 * A small set of hand-rolled primitives rather than a component library.
 *
 * The whole set is under 200 lines, has no runtime dependency, and every rule
 * in it can be explained. A library would have been faster to install and
 * slower to justify.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------- Button --- */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary:
    "border border-rule-strong bg-surface text-ink hover:bg-subtle",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-ink-2 hover:bg-subtle",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)}
    />
  );
}

/* --------------------------------------------------------------- Field --- */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid,
  ...props
}: ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted",
        invalid ? "border-danger" : "border-rule-strong",
        className,
      )}
    />
  );
}

export function Select({
  className,
  invalid,
  ...props
}: ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink",
        invalid ? "border-danger" : "border-rule-strong",
        className,
      )}
    />
  );
}

/* ---------------------------------------------------------- PageHeader --- */

/**
 * The top line of every page: what this is, and the one thing you do here.
 *
 * Before this existed each page invented its own header, and the primary
 * action ended up wherever that page happened to put it — "Add patient" beside
 * the title, "Import" halfway down a card, "Send assessment" inside a third
 * card's header. One slot in one place means a page can be read at a glance
 * without hunting for its verb.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  badge,
  action,
}: {
  /** A back link or breadcrumb, above the title. */
  eyebrow?: ReactNode;
  title: string;
  description?: string;
  /** Sits with the title — status about the thing, not an action on it. */
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-rule pb-5">
      {eyebrow}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {title}
            </h1>
            {badge}
          </div>
          {description ? (
            <p className="text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Card --- */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx(
        "rounded-lg border border-rule bg-surface",
        className,
      )}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="text-xs text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- Alert --- */

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: "danger" | "success" | "info";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger-soft text-ink",
    success: "border-success/30 bg-success-soft text-ink",
    info: "border-accent/25 bg-accent-soft text-ink",
  } as const;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("rounded-md border px-4 py-3 text-sm", tones[tone])}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-0.5" : undefined}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------- EmptyState --- */

/**
 * The brief calls this out explicitly: "A dashboard with no data should look
 * intentional, not broken." Empty is a designed state, not an absence.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- Skeleton -- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("animate-pulse rounded bg-subtle", className)}
    />
  );
}

/* ----------------------------------------------------------------- Badge -- */

type BadgeTone = "neutral" | "low" | "moderate" | "high" | "critical" | "accent";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-subtle text-ink-2",
  low: "bg-band-low-soft text-band-low",
  moderate: "bg-band-moderate-soft text-band-moderate",
  high: "bg-band-high-soft text-band-high",
  critical: "bg-band-critical-soft text-band-critical",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export { cx };
