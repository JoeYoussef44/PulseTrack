"use client"; // Error boundaries must be Client Components.

/**
 * Last resort: this replaces the root layout, so it only renders when the
 * layout itself failed and every other boundary is already gone.
 *
 * Two constraints follow from that, both documented in the Next.js 16 error
 * conventions:
 *
 *  1. It must supply its own <html> and <body>.
 *  2. Global styles are NOT loaded here, so Tailwind classes would do nothing.
 *     Everything below is inline, which is why it looks hand-written.
 *
 * Next.js 16 names the recovery prop `retry`, not `reset`.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f7f8f7",
          color: "#14201c",
          fontFamily:
            "'Segoe UI', -apple-system, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: "10px",
              letterSpacing: "0.11em",
              textTransform: "uppercase",
              color: "#6b7873",
              fontFamily: "ui-monospace, Consolas, monospace",
            }}
          >
            PulseTrack
          </p>

          <h1 style={{ margin: "0 0 10px", fontSize: "20px" }}>
            The application could not start
          </h1>

          <p
            style={{
              margin: "0 0 16px",
              fontSize: "14px",
              lineHeight: 1.55,
              color: "#3d4a45",
            }}
          >
            This is not something you did. No data has been changed. Trying
            again will usually resolve it.
          </p>

          {error.digest ? (
            <p
              style={{
                margin: "0 0 16px",
                fontSize: "11px",
                color: "#6b7873",
                fontFamily: "ui-monospace, Consolas, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => retry()}
            style={{
              border: 0,
              borderRadius: "6px",
              padding: "9px 16px",
              fontSize: "14px",
              fontWeight: 500,
              color: "#fff",
              background: "#0f5132",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
