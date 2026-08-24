/**
 * FHIR Bundle pagination.
 *
 * The API guide says to "follow the bundle's `next` link". Doing that
 * verbatim does not work against this server, and the failure is silent.
 *
 * Verified against the live server on 2026-08-24 (see .docs §23): the returned
 * links point at the server's own container hostname —
 *
 *     next -> http://hapi:8080/fhir?_getpages=c9b366f6-…&_getpagesoffset=20
 *
 * `hapi:8080` is a Docker-internal name. Fetching it from outside the cluster
 * returns a connection failure, so a naive `fetch(nextUrl)` truncates every
 * import to its first page without raising anything that looks like an error.
 *
 * The fix is to keep the link's path tail and query — which carry the server's
 * own opaque `_getpages` cursor and must not be reconstructed by hand — while
 * discarding its unreachable origin.
 */

/** Bundle link entry, per FHIR R4. */
export interface BundleLink {
  relation: string;
  url: string;
}

/**
 * Rewrites a Bundle link onto our configured public base URL.
 *
 * @param linkUrl the raw `url` from `bundle.link[]`
 * @param baseUrl our configured FHIR base, e.g. https://host/fhir
 */
export function rebaseBundleLink(linkUrl: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(linkUrl);
  } catch {
    // Relative link — append to the base as-is.
    return `${base}/${linkUrl.replace(/^\/+/, "")}`;
  }

  // The FHIR root segment is the join point. Everything after it (resource
  // type, id, operation) belongs to the request; everything before it is the
  // origin we are replacing.
  const marker = "/fhir";
  const idx = parsed.pathname.indexOf(marker);
  const tail =
    idx >= 0 ? parsed.pathname.slice(idx + marker.length) : parsed.pathname;

  return `${base}${tail}${parsed.search}`;
}

/**
 * Returns the next page URL, already rebased, or null when the bundle is the
 * last page.
 */
export function nextPageUrl(
  links: BundleLink[] | undefined,
  baseUrl: string,
): string | null {
  const next = links?.find((l) => l.relation === "next");
  return next?.url ? rebaseBundleLink(next.url, baseUrl) : null;
}

/**
 * How many results to request per page.
 *
 * Deliberately 20, not the guide's suggested 50. Each seeded patient has
 * exactly 36 observations, so `_count=50` returns everything in a single page
 * and the pagination path never executes. At 20 every patient pages twice
 * (20 + 16), which exercises the loop against real data.
 */
export const PAGE_SIZE = 20;

/**
 * Upper bound on pages followed in one pull. A cursor loop against a remote
 * server needs a stop condition that does not depend on the server behaving.
 */
export const MAX_PAGES = 50;

export interface PageWalkResult<T> {
  items: T[];
  pagesFetched: number;
  /** True when MAX_PAGES was hit with a next link still outstanding. */
  truncated: boolean;
}

/**
 * Walks a search result to exhaustion, following rebased `next` links.
 *
 * Guards against three ways this loop can misbehave: a server that returns a
 * cursor pointing back at a page we have already read, a server that never
 * stops offering a next link, and a caller that assumes `bundle.total` is
 * present — it is omitted on paged responses, so loop control depends on the
 * presence of a next link and nothing else.
 */
export async function walkPages<T>(
  firstUrl: string,
  baseUrl: string,
  fetchPage: (url: string) => Promise<{ entries: T[]; links?: BundleLink[] }>,
): Promise<PageWalkResult<T>> {
  const items: T[] = [];
  const seen = new Set<string>();

  let url: string | null = firstUrl;
  let pagesFetched = 0;

  while (url && pagesFetched < MAX_PAGES) {
    if (seen.has(url)) break; // cursor looped back on itself
    seen.add(url);

    const page = await fetchPage(url);
    pagesFetched += 1;
    items.push(...page.entries);

    url = nextPageUrl(page.links, baseUrl);
  }

  return { items, pagesFetched, truncated: url !== null };
}
