/**
 * Shared NRI types. The snapshot is deliberately a plain data structure: the
 * rules that read it are pure functions, so every threshold in this engine can
 * be tested without a database.
 */

export type SignalKind = "check_in" | "connection" | "heads_up" | "celebration";

export interface CandidateSignal {
  kind: SignalKind;
  title: string;
  summary: string;
  /** Why am I seeing this? Rendered verbatim in the transparency drawer. */
  evidence: Record<string, unknown>;
  confidence: "high" | "medium" | "moderate";
  subjectType?: "contact" | "item" | "shift" | "org";
  subjectId?: string;
  /** Stable across re-runs so the same noticing is never written twice. */
  dedupeKey: string;
}

export interface DonorSnapshot {
  contactId: string;
  name: string;
  donationCount: number;
  firstDonationAt: string;
  lastDonationAt: string;
  daysSinceLast: number;
  /** Typical gap between this donor's own visits — their rhythm, not a target. */
  medianGapDays: number | null;
  hasReceipt: boolean;
  acknowledged: boolean;
}

export interface VolunteerSnapshot {
  contactId: string;
  name: string;
  shiftsLast90: number;
  hoursLast90: number;
  lastShiftAt: string | null;
  daysSinceLast: number | null;
  upcomingShifts: number;
}

export interface InventorySnapshot {
  available: number;
  intakeLast7: number;
  intakePrev7: number;
  soldLast7: number;
  soldPrev7: number;
  /** Items sitting at the deepest markdown their tag allows. */
  atFinalMarkdown: number;
  unpriced: number;
  /** Items on the floor longer than the full rotation. */
  pastRotation: number;
  oldestAvailableDays: number;
}

export interface ImpactSnapshot {
  diversionLbsTotal: number;
  diversionLbsThisMonth: number;
  itemsRehomedTotal: number;
  itemsRehomedThisMonth: number;
  valueDeliveredCentsThisMonth: number;
  volunteerHoursThisMonth: number;
  volunteerHoursPrevMonth: number;
  volunteerHeadcountThisMonth: number;
}

export interface MultiRoleContact {
  contactId: string;
  name: string;
  roles: string[];
  /** Roles picked up inside the lookback window — the relationship deepening. */
  newRoles: string[];
}

export interface NriSnapshot {
  orgId: string;
  orgName: string;
  now: string;
  /** Donors whose own rhythm suggests they'd normally have been back by now. */
  quietDonors: DonorSnapshot[];
  /** Donors who came back after a long gap. */
  returningDonors: DonorSnapshot[];
  firstTimeDonorsUnacknowledged: DonorSnapshot[];
  donationsMissingReceipts: number;
  donationsMissingReceiptsOldestDays: number;
  quietVolunteers: VolunteerSnapshot[];
  volunteersWithoutUpcoming: number;
  inventory: InventorySnapshot;
  impact: ImpactSnapshot;
  multiRoleContacts: MultiRoleContact[];
  reflectionsLast30: number;
  reflectionsPrev30: number;
  /** Milestone thresholds already celebrated, so we never repeat one. */
  celebratedMilestones: string[];
}
