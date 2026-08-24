import { describe, expect, it } from "vitest";

import {
  parseIsoDate,
  patientSchema,
  toIsoDate,
} from "@/lib/validation/patient";

const VALID = {
  fullName: "Jane Doe",
  mrn: "MRN-1004",
  dateOfBirth: "1980-05-12",
  sex: "FEMALE",
  email: "jane@example.test",
  phone: "+961 3 111 001",
};

function errorFor(field: string, overrides: Record<string, unknown>) {
  const result = patientSchema.safeParse({ ...VALID, ...overrides });
  if (result.success) return null;
  return result.error.issues.find((i) => i.path[0] === field)?.message ?? null;
}

describe("patient schema - happy path", () => {
  it("accepts a complete valid record", () => {
    expect(patientSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a record with no email or phone", () => {
    const result = patientSchema.safeParse({
      ...VALID,
      email: "",
      phone: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
    }
  });
});

describe("normalisation", () => {
  it("uppercases and trims the MRN so casing cannot create a duplicate", () => {
    const result = patientSchema.safeParse({ ...VALID, mrn: "  mrn-1004 " });
    expect(result.success && result.data.mrn).toBe("MRN-1004");
  });

  it("lowercases the email", () => {
    const result = patientSchema.safeParse({
      ...VALID,
      email: "  Jane@Example.TEST ",
    });
    expect(result.success && result.data.email).toBe("jane@example.test");
  });

  it("trims the full name", () => {
    const result = patientSchema.safeParse({ ...VALID, fullName: "  Jane Doe  " });
    expect(result.success && result.data.fullName).toBe("Jane Doe");
  });
});

describe("date of birth", () => {
  it("rejects a future date", () => {
    const nextYear = new Date();
    nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);

    expect(errorFor("dateOfBirth", { dateOfBirth: toIsoDate(nextYear) })).toMatch(
      /future/i,
    );
  });

  it("rejects tomorrow specifically", () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    expect(errorFor("dateOfBirth", { dateOfBirth: toIsoDate(tomorrow) })).toMatch(
      /future/i,
    );
  });

  it("accepts today", () => {
    const today = toIsoDate(new Date());
    expect(errorFor("dateOfBirth", { dateOfBirth: today })).toBeNull();
  });

  it("rejects a date that does not exist (30 February)", () => {
    expect(errorFor("dateOfBirth", { dateOfBirth: "2026-02-30" })).toMatch(
      /does not exist/i,
    );
  });

  it("rejects an impossible month", () => {
    expect(errorFor("dateOfBirth", { dateOfBirth: "2026-13-01" })).toBeTruthy();
  });

  it("rejects a non-ISO format", () => {
    expect(errorFor("dateOfBirth", { dateOfBirth: "01/06/1980" })).toBeTruthy();
  });

  it("rejects an implausibly distant year", () => {
    expect(errorFor("dateOfBirth", { dateOfBirth: "1850-01-01" })).toMatch(
      /within the last/i,
    );
  });

  it("accepts a real leap day", () => {
    expect(errorFor("dateOfBirth", { dateOfBirth: "2024-02-29" })).toBeNull();
  });
});

describe("email", () => {
  it.each(["jane@", "@example.com", "jane@@example.com", "jane example.com"])(
    "rejects %s",
    (email) => {
      expect(errorFor("email", { email })).toBeTruthy();
    },
  );
});

describe("phone - permissive by design", () => {
  it.each([
    "+961 3 111 001",
    "+1 (555) 010-9999",
    "03111001",
    "+44 20 7946 0958",
  ])("accepts %s", (phone) => {
    expect(errorFor("phone", { phone })).toBeNull();
  });

  it("rejects letters", () => {
    expect(errorFor("phone", { phone: "call me" })).toBeTruthy();
  });
});

describe("required fields", () => {
  it.each([
    ["fullName", ""],
    ["mrn", ""],
    ["dateOfBirth", ""],
  ])("rejects an empty %s", (field, value) => {
    expect(errorFor(field, { [field]: value })).toBeTruthy();
  });

  it("rejects an unknown sex value", () => {
    expect(errorFor("sex", { sex: "yes" })).toBeTruthy();
  });
});

describe("date helpers avoid timezone drift", () => {
  it("round-trips a date without shifting the day", () => {
    // The classic off-by-one: west of UTC, a locally-constructed date stores
    // the previous day and every chart renders shifted.
    for (const iso of ["2026-05-02", "2026-01-01", "2026-12-31", "2024-02-29"]) {
      expect(toIsoDate(parseIsoDate(iso))).toBe(iso);
    }
  });

  it("parses at UTC midnight", () => {
    const d = parseIsoDate("2026-05-02");
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCDate()).toBe(2);
  });
});
