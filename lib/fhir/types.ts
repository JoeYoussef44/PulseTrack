/**
 * The slice of FHIR R4 this app actually uses.
 *
 * Hand-written rather than pulled from a types package, and deliberately
 * narrow: these are the fields we read or write, with everything optional that
 * the live server has actually been observed to omit. A full R4 type surface
 * would be thousands of lines describing resources we never touch, and would
 * hide which fields we genuinely depend on.
 *
 * Every field marked optional here is optional because the *server* made it so
 * — `referenceRange` is absent on all seeded observations, and `total` is
 * absent on paged bundles (verified, .docs §23).
 */

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Identifier {
  system?: string;
  value?: string;
}

export interface Meta {
  versionId?: string;
  lastUpdated?: string;
  tag?: Coding[];
}

export interface HumanName {
  family?: string;
  given?: string[];
  text?: string;
}

export type FhirGender = "male" | "female" | "other" | "unknown";

export interface FhirPatient {
  resourceType: "Patient";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  name?: HumanName[];
  gender?: FhirGender;
  birthDate?: string;
}

export interface Quantity {
  value?: number;
  unit?: string;
  system?: string;
  code?: string;
}

export interface ObservationReferenceRange {
  low?: Quantity;
  high?: Quantity;
}

export interface FhirObservation {
  resourceType: "Observation";
  id?: string;
  meta?: Meta;
  identifier?: Identifier[];
  status: "final";
  category?: CodeableConcept[];
  code: CodeableConcept;
  subject: { reference: string };
  effectiveDateTime?: string;
  effectivePeriod?: { start?: string; end?: string };
  valueQuantity?: Quantity;
  referenceRange?: ObservationReferenceRange[];
}

export type FhirResource = FhirPatient | FhirObservation;

export interface BundleEntry<T> {
  fullUrl?: string;
  resource?: T;
}

export interface Bundle<T> {
  resourceType: "Bundle";
  type?: string;
  /** Absent on paged searches — never use it for loop control. */
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<BundleEntry<T>>;
}

export interface OperationOutcomeIssue {
  severity?: "fatal" | "error" | "warning" | "information";
  code?: string;
  diagnostics?: string;
}

export interface OperationOutcome {
  resourceType: "OperationOutcome";
  issue?: OperationOutcomeIssue[];
}

export function isOperationOutcome(body: unknown): body is OperationOutcome {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { resourceType?: unknown }).resourceType === "OperationOutcome"
  );
}
