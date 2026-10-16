import type { PracticalFitBand } from "./types";

export type FitStatus = "match" | "negotiable" | "mismatch" | "unknown";

export interface PracticalFitData {
  currentLocation: string;
  willingToRelocate: "yes" | "no" | "depends" | "";
  relocationNote?: string;
  workModel: "onsite" | "hybrid" | "remote" | "flexible" | "";
  noticeDays: number | null;
  noticeNegotiable: boolean;
  servingNotice: boolean;
  earliestJoiningDate: string;
  expectedCompMin: number | null;
  expectedCompMax: number | null;
  compCurrency: string;
  compPreferLater: boolean;
  otherOffers: "yes" | "no" | "prefer_not" | "";
  notes?: string;
}

export function emptyPracticalFit(currency = "INR"): PracticalFitData {
  return {
    currentLocation: "",
    willingToRelocate: "",
    workModel: "",
    noticeDays: null,
    noticeNegotiable: false,
    servingNotice: false,
    earliestJoiningDate: "",
    expectedCompMin: null,
    expectedCompMax: null,
    compCurrency: currency,
    compPreferLater: false,
    otherOffers: "",
  };
}

export interface FitField {
  field: string;
  label: string;
  status: FitStatus;
  detail: string;
}

export interface Compatibility {
  overall: FitStatus;
  fields: FitField[];
}

const rank: Record<FitStatus, number> = { match: 0, unknown: 1, negotiable: 2, mismatch: 3 };

/** Compare declared practical details with the drive's band (FEATURES §9.4). Never part of the score. */
export function checkCompatibility(
  data: PracticalFitData,
  band: PracticalFitBand,
  opts: { askCompensation: boolean },
): Compatibility {
  const fields: FitField[] = [];

  if (opts.askCompensation && band.budgetMax != null) {
    if (data.compPreferLater || data.expectedCompMin == null) {
      fields.push({ field: "compensation", label: "Expected compensation", status: "unknown", detail: "Candidate prefers to discuss later" });
    } else if (data.expectedCompMin <= band.budgetMax) {
      fields.push({ field: "compensation", label: "Expected compensation", status: "match", detail: `Expects from ${data.expectedCompMin} ${data.compCurrency}; budget up to ${band.budgetMax}` });
    } else if (data.expectedCompMin <= band.budgetMax * 1.15) {
      fields.push({ field: "compensation", label: "Expected compensation", status: "negotiable", detail: `Expects from ${data.expectedCompMin}; within 15% above budget max ${band.budgetMax}` });
    } else {
      fields.push({ field: "compensation", label: "Expected compensation", status: "mismatch", detail: `Expects from ${data.expectedCompMin}; budget max ${band.budgetMax}` });
    }
  }

  if (band.maxNoticeDays != null) {
    if (data.noticeDays == null) {
      fields.push({ field: "notice", label: "Notice period", status: "unknown", detail: "Not provided" });
    } else if (data.noticeDays <= band.maxNoticeDays) {
      fields.push({ field: "notice", label: "Notice period", status: "match", detail: `${data.noticeDays} days (max ${band.maxNoticeDays})` });
    } else if (data.noticeDays <= band.maxNoticeDays + 30 || data.noticeNegotiable) {
      fields.push({ field: "notice", label: "Notice period", status: "negotiable", detail: `${data.noticeDays} days${data.noticeNegotiable ? ", negotiable" : ""} (max ${band.maxNoticeDays})` });
    } else {
      fields.push({ field: "notice", label: "Notice period", status: "mismatch", detail: `${data.noticeDays} days (max ${band.maxNoticeDays})` });
    }
  }

  if (band.locations.length) {
    const loc = data.currentLocation.toLowerCase();
    const inLoc = band.locations.some((l) => loc.includes(l.toLowerCase()));
    let status: FitStatus;
    if (!data.currentLocation) status = "unknown";
    else if (inLoc || data.willingToRelocate === "yes") status = "match";
    else if (data.willingToRelocate === "depends") status = "negotiable";
    else status = "mismatch";
    fields.push({
      field: "location",
      label: "Location",
      status,
      detail: `${data.currentLocation || "—"}; relocate: ${data.willingToRelocate || "—"} (role: ${band.locations.join(", ")})`,
    });
  }

  if (band.workModels.length) {
    let status: FitStatus;
    if (!data.workModel) status = "unknown";
    else if (data.workModel === "flexible") status = "negotiable";
    else status = band.workModels.includes(data.workModel) ? "match" : "mismatch";
    fields.push({ field: "workModel", label: "Work model", status, detail: `Prefers ${data.workModel || "—"} (role: ${band.workModels.join(", ")})` });
  }

  const overall = fields.reduce<FitStatus>((acc, f) => (rank[f.status] > rank[acc] ? f.status : acc), "match");
  return { overall: fields.length ? overall : "unknown", fields };
}
