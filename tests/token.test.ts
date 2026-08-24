import { describe, expect, it } from "vitest";

import {
  addDays,
  assessmentUrl,
  hashToken,
  isExpired,
  issueToken,
  tokenHashEquals,
} from "@/lib/assessments/token";

describe("token generation", () => {
  it("produces a URL-safe token with no padding", () => {
    const { rawToken } = issueToken();
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries at least 32 bytes of entropy", () => {
    const { rawToken } = issueToken();
    // 32 raw bytes -> 43 base64url characters.
    expect(rawToken.length).toBeGreaterThanOrEqual(43);
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => issueToken().rawToken),
    );
    expect(seen.size).toBe(500);
  });

  it("returns a hash that is not the token", () => {
    const { rawToken, tokenHash } = issueToken();
    expect(tokenHash).not.toBe(rawToken);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes deterministically, so lookup by hash works", () => {
    const { rawToken, tokenHash } = issueToken();
    expect(hashToken(rawToken)).toBe(tokenHash);
  });

  it("gives different tokens different hashes", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("expiry", () => {
  it("expires exactly 7 days after issue", () => {
    const now = new Date("2026-08-24T09:00:00.000Z");
    const { expiresAt } = issueToken(now);
    expect(expiresAt.toISOString()).toBe("2026-08-31T09:00:00.000Z");
  });

  it("is still valid one second before expiry", () => {
    const expiresAt = new Date("2026-08-31T09:00:00.000Z");
    const justBefore = new Date("2026-08-31T08:59:59.000Z");
    expect(isExpired(expiresAt, justBefore)).toBe(false);
  });

  it("is expired exactly at the expiry instant", () => {
    const expiresAt = new Date("2026-08-31T09:00:00.000Z");
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("is expired one second after", () => {
    const expiresAt = new Date("2026-08-31T09:00:00.000Z");
    const justAfter = new Date("2026-08-31T09:00:01.000Z");
    expect(isExpired(expiresAt, justAfter)).toBe(true);
  });

  it("crosses month boundaries correctly", () => {
    const issued = new Date("2026-02-25T12:00:00.000Z");
    expect(addDays(issued, 7).toISOString().slice(0, 10)).toBe("2026-03-04");
  });
});

describe("hash comparison", () => {
  it("matches identical hashes", () => {
    const h = hashToken("abc");
    expect(tokenHashEquals(h, h)).toBe(true);
  });

  it("rejects different hashes", () => {
    expect(tokenHashEquals(hashToken("abc"), hashToken("abd"))).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(tokenHashEquals("short", hashToken("abc"))).toBe(false);
  });
});

describe("assessment url", () => {
  it("puts the token in the path and nothing else in the URL", () => {
    const url = assessmentUrl("TOKEN123", "https://pulsetrack.example");
    expect(url).toBe("https://pulsetrack.example/assessment/TOKEN123");
  });

  it("tolerates a trailing slash on the base", () => {
    expect(assessmentUrl("T", "https://x.example/")).toBe(
      "https://x.example/assessment/T",
    );
  });

  it("contains no patient identifier", () => {
    const url = assessmentUrl("TOKEN123", "https://pulsetrack.example");
    expect(url).not.toMatch(/mrn|email|patient|id=/i);
  });
});
