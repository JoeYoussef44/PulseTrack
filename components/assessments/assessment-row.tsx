"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A table row that navigates when you click anywhere in it.
 *
 * The obvious implementation is CSS: `position: relative` on the `<tr>` and a
 * stretched `::after` on one anchor inside it. That was built first and it does
 * not work — measured in Chrome, not assumed. A table row does not reliably
 * establish a containing block for an absolutely positioned descendant, so the
 * pseudo-element resolves against something further up and the far side of the
 * row is not a hit target. `elementFromPoint` at the row's right edge returned
 * a cell, not the link, and a click there navigated nowhere.
 *
 * So the row keeps one real anchor, in the first cell, and this adds a mouse
 * convenience on top of it. That ordering is the point:
 *
 *  - **The anchor is the navigation.** Keyboard focus, middle-click, open in a
 *    new tab, "copy link address", and a screen reader's list of links all go
 *    through it and all still work. There is exactly one link per row, not six
 *    to the same place.
 *  - **This handler is an enhancement.** With JavaScript unavailable the row
 *    stops being clickable and the link still is, which is the right way round.
 *
 * The guard matters: a click that lands on the anchor itself, or on any other
 * interactive element the row may grow later, is left alone. Without it the
 * anchor's own navigation and this one both fire for a single click.
 */
export function AssessmentRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <tr
      className={className}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a, button, input, select, textarea, label")) return;

        // Selecting text in a row is a real thing a clinician does with an
        // MRN or a date, and it should not be read as a request to navigate.
        if (window.getSelection()?.toString()) return;

        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
