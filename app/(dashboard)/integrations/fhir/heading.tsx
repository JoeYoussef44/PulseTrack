import { PageHeader } from "@/components/ui";

/**
 * The page's own header, shared by the page and its loading state.
 *
 * It lives here rather than being written out twice because the two copies
 * drifting apart is precisely the defect this route already had: the loading
 * skeleton claimed to mirror a layout it had stopped matching.
 */
export function PageHeading() {
  return (
    <PageHeader
      title="National platform"
      description="This clinic reports to a shared FHIR R4 server and imports historical results from it."
    />
  );
}
