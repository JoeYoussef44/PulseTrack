import { describe, expect, it } from "vitest";

import {
  classifyStatus,
  FhirError,
  readDiagnostics,
  retryDelayMs,
} from "@/lib/fhir/errors";
import { Throttle } from "@/lib/fhir/throttle";

/**
 * The retry policy, tested as policy rather than plumbing.
 *
 * "Is a 403 ever retried?" is a decision about how this app treats a shared
 * server whose writes are permanent — not an implementation detail. Getting it
 * wrong burns a documented 120 requests/minute re-learning that we still do
 * not own someone else's resource.
 */

describe("classifyStatus", () => {
  it("treats rate limiting and server faults as transient", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      const { kind } = classifyStatus(status);
      expect(new FhirError(kind, "").retryable, `status ${status}`).toBe(true);
    }
  });

  it("never retries a permission or validation failure", () => {
    // Each of these describes a stable fact about the world. Retrying changes
    // nothing except how much of the rate limit is spent finding out.
    for (const status of [400, 401, 403, 404, 405, 412, 422]) {
      const { kind } = classifyStatus(status);
      expect(new FhirError(kind, "").retryable, `status ${status}`).toBe(false);
    }
  });

  it("names the three write rules the server enforces", () => {
    expect(classifyStatus(403).kind).toBe("forbidden");
    expect(classifyStatus(405).kind).toBe("method");
    expect(classifyStatus(412).kind).toBe("conflict");
  });

  it("explains an auth failure in terms of the variable to check", () => {
    expect(classifyStatus(401).message).toContain("FHIR_API_KEY");
  });

  it("does not classify an unfamiliar 4xx as retryable", () => {
    expect(new FhirError(classifyStatus(418).kind, "").retryable).toBe(false);
  });
});

describe("readDiagnostics", () => {
  const outcome = {
    resourceType: "OperationOutcome",
    issue: [
      { severity: "warning", diagnostics: "Profile not validated" },
      { severity: "error", diagnostics: "Conditional create matched 5 resources" },
    ],
  };

  it("prefers the error over an accompanying warning", () => {
    expect(readDiagnostics(outcome)).toBe(
      "Conditional create matched 5 resources",
    );
  });

  it("ignores a body that is not an OperationOutcome", () => {
    expect(readDiagnostics({ resourceType: "Patient", id: "1" })).toBeUndefined();
    expect(readDiagnostics(null)).toBeUndefined();
    expect(readDiagnostics("boom")).toBeUndefined();
  });

  it("truncates a stack trace rather than storing all of it", () => {
    const long = {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", diagnostics: "x".repeat(1000) }],
    };

    const text = readDiagnostics(long) ?? "";
    expect(text.length).toBeLessThanOrEqual(301);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("FhirError.toRecord", () => {
  it("combines the message and the server's own explanation", () => {
    const error = new FhirError("conflict", "Two records matched.", {
      diagnostics: "If-None-Exist matched 5 resources",
    });

    expect(error.toRecord()).toBe(
      "Two records matched. — If-None-Exist matched 5 resources",
    );
  });

  it("stays inside the column it is written to", () => {
    const error = new FhirError("server", "y".repeat(600));
    expect(error.toRecord().length).toBeLessThanOrEqual(500);
  });

  it("does not repeat the message when diagnostics say the same thing", () => {
    const error = new FhirError("server", "Down.", { diagnostics: "Down." });
    expect(error.toRecord()).toBe("Down.");
  });
});

describe("retryDelayMs", () => {
  it("honours Retry-After over its own backoff curve", () => {
    // The server knows when it will accept traffic again; our curve is a guess.
    expect(retryDelayMs(1, "5")).toBe(5000);
  });

  it("caps an absurd Retry-After rather than hanging the import", () => {
    expect(retryDelayMs(1, "3600")).toBe(30_000);
  });

  it("ignores an HTTP-date Retry-After it cannot read as seconds", () => {
    const delay = retryDelayMs(1, "Wed, 26 Aug 2026 12:00:00 GMT");
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(1300);
  });

  it("backs off exponentially and adds jitter", () => {
    // Jitter matters because an import retries many records at once: without
    // it they all retry on the same tick and re-trigger the rate limit.
    const first = retryDelayMs(1);
    const second = retryDelayMs(2);
    const third = retryDelayMs(3);

    expect(first).toBeGreaterThanOrEqual(1000);
    expect(second).toBeGreaterThanOrEqual(2000);
    expect(third).toBeGreaterThanOrEqual(4000);
    expect(third).toBeLessThan(9000);
  });
});

describe("Throttle", () => {
  it("holds requests over the window ceiling instead of sending them", async () => {
    const throttle = new Throttle({
      windowMs: 200,
      maxInWindow: 2,
      maxConcurrent: 4,
    });

    const started = Date.now();

    for (let i = 0; i < 3; i++) {
      await throttle.acquire();
      throttle.release();
    }

    // The third has to wait for the first to leave the window.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });

  it("lets a burst inside the ceiling through without delay", async () => {
    const throttle = new Throttle({ windowMs: 60_000, maxInWindow: 10 });
    const started = Date.now();

    for (let i = 0; i < 5; i++) {
      await throttle.acquire();
      throttle.release();
    }

    expect(Date.now() - started).toBeLessThan(50);
  });

  it("caps how many requests are in flight at once", async () => {
    const throttle = new Throttle({
      windowMs: 60_000,
      maxInWindow: 100,
      maxConcurrent: 2,
    });

    let inFlight = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await throttle.acquire();
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        throttle.release();
      }),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });
});
