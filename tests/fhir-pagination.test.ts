import { describe, expect, it } from "vitest";

import {
  MAX_PAGES,
  nextPageUrl,
  rebaseBundleLink,
  walkPages,
} from "@/lib/fhir/pagination";

const BASE = "https://fhir-challenge.vihagent.net/fhir";

describe("rebaseBundleLink", () => {
  it("rewrites the server's internal host onto our public base", () => {
    // Verbatim from the live server, 2026-08-24.
    const internal =
      "http://hapi:8080/fhir?_getpages=c9b366f6-cbd2-4d17-aa03-5865a037ea56&_getpagesoffset=20&_count=20&_bundletype=searchset";

    const rebased = rebaseBundleLink(internal, BASE);

    expect(rebased).toBe(
      `${BASE}?_getpages=c9b366f6-cbd2-4d17-aa03-5865a037ea56&_getpagesoffset=20&_count=20&_bundletype=searchset`,
    );
    expect(rebased).not.toContain("hapi:8080");
  });

  it("preserves the opaque _getpages cursor exactly", () => {
    const internal = "http://hapi:8080/fhir?_getpages=abc-123&_getpagesoffset=40";
    const url = new URL(rebaseBundleLink(internal, BASE));

    expect(url.searchParams.get("_getpages")).toBe("abc-123");
    expect(url.searchParams.get("_getpagesoffset")).toBe("40");
  });

  it("keeps a resource path tail after the /fhir root", () => {
    const internal = "http://hapi:8080/fhir/Observation?subject=Patient/1&_count=20";
    expect(rebaseBundleLink(internal, BASE)).toBe(
      `${BASE}/Observation?subject=Patient/1&_count=20`,
    );
  });

  it("tolerates a trailing slash on the configured base", () => {
    const internal = "http://hapi:8080/fhir?_getpages=x";
    expect(rebaseBundleLink(internal, `${BASE}/`)).toBe(`${BASE}?_getpages=x`);
  });

  it("is idempotent when the link is already public", () => {
    const already = `${BASE}/Observation?_count=20`;
    expect(rebaseBundleLink(already, BASE)).toBe(already);
  });
});

describe("nextPageUrl", () => {
  it("returns null on the last page (self and previous only)", () => {
    const links = [
      { relation: "self", url: "http://hapi:8080/fhir/Observation?_count=20" },
      { relation: "previous", url: "http://hapi:8080/fhir?_getpages=x" },
    ];
    expect(nextPageUrl(links, BASE)).toBeNull();
  });

  it("returns null when there are no links at all", () => {
    expect(nextPageUrl(undefined, BASE)).toBeNull();
  });

  it("returns a rebased url when a next link is present", () => {
    const links = [
      { relation: "self", url: "http://hapi:8080/fhir/Observation" },
      { relation: "next", url: "http://hapi:8080/fhir?_getpages=y" },
    ];
    expect(nextPageUrl(links, BASE)).toBe(`${BASE}?_getpages=y`);
  });
});

describe("walkPages", () => {
  it("follows next links to exhaustion and concatenates results", async () => {
    // Mirrors the real shape: 36 observations over two pages of 20 + 16.
    const pages: Record<string, { entries: number[]; links?: { relation: string; url: string }[] }> = {
      [`${BASE}/Observation?_count=20`]: {
        entries: Array.from({ length: 20 }, (_, i) => i),
        links: [{ relation: "next", url: "http://hapi:8080/fhir?_getpages=p2" }],
      },
      [`${BASE}?_getpages=p2`]: {
        entries: Array.from({ length: 16 }, (_, i) => 20 + i),
        links: [{ relation: "previous", url: "http://hapi:8080/fhir?_getpages=p1" }],
      },
    };

    const result = await walkPages<number>(
      `${BASE}/Observation?_count=20`,
      BASE,
      async (url) => pages[url] ?? { entries: [] },
    );

    expect(result.items).toHaveLength(36);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops instead of looping when a cursor points at a page already read", async () => {
    const selfReferential = `${BASE}?_getpages=loop`;

    const result = await walkPages<number>(selfReferential, BASE, async () => ({
      entries: [1],
      links: [{ relation: "next", url: "http://hapi:8080/fhir?_getpages=loop" }],
    }));

    expect(result.pagesFetched).toBe(1);
    expect(result.items).toEqual([1]);
  });

  it("stops at MAX_PAGES and reports truncation rather than hiding it", async () => {
    let n = 0;

    const result = await walkPages<number>(`${BASE}/Observation`, BASE, async () => {
      n += 1;
      return {
        entries: [n],
        // A distinct cursor every time, so the seen-set guard never fires.
        links: [{ relation: "next", url: `http://hapi:8080/fhir?_getpages=${n}` }],
      };
    });

    expect(result.pagesFetched).toBe(MAX_PAGES);
    expect(result.truncated).toBe(true);
  });
});
