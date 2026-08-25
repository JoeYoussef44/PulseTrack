import { Card } from "@/components/ui";

/**
 * The patient's identity, on one line, above everything else on the page.
 *
 * This replaces the "Patient details" card, which was a full-height panel of
 * six fields that pushed the first chart below the fold. The information has
 * not changed; only its cost in vertical space has. Every clinical product
 * keeps identity visible while you work — Epic calls it the Storyboard and
 * runs it down the left edge; ours runs across the top, because our content is
 * wide rather than tall.
 *
 * It sticks to the top of the viewport from `lg` up, so scrolling to a lab
 * result three years old never leaves you wondering whose it is.
 */

function Item({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="font-mono text-[10px] tracking-[0.11em] text-muted uppercase">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "truncate font-mono text-sm text-ink"
            : "truncate text-sm text-ink"
        }
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function IdentityBanner({
  mrn,
  dateOfBirth,
  sex,
  email,
  phone,
  platform,
}: {
  mrn: string;
  dateOfBirth: string;
  sex: string;
  email: string;
  phone: string;
  platform: string;
}) {
  return (
    <Card className="lg:sticky lg:top-4 lg:z-20">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3 xl:grid-cols-6">
        <Item label="MRN" value={mrn} mono />
        <Item label="Date of birth" value={dateOfBirth} mono />
        <Item label="Sex" value={sex} />
        <Item label="Email" value={email} />
        <Item label="Phone" value={phone} />
        <Item label="National platform" value={platform} />
      </dl>
    </Card>
  );
}
