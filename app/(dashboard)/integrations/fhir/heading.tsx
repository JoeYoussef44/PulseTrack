/**
 * The page's own title, shared by the page and its loading state.
 *
 * It lives here rather than being written out twice because the two copies
 * drifting apart is precisely the defect this route already had: the loading
 * skeleton claimed to mirror a layout it had stopped matching.
 */
export function PageHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        National platform
      </h1>
      <p className="text-sm text-muted">
        This clinic reports to a shared FHIR R4 server and imports historical
        results from it.
      </p>
    </div>
  );
}
