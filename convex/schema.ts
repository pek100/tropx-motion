import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const ROLES = {
  PHYSIOTHERAPIST: "physiotherapist",
  PATIENT: "patient",
  ADMIN: "admin",
} as const;

export const JOINTS = {
  LEFT_KNEE: "left_knee",
  RIGHT_KNEE: "right_knee",
} as const;

export const RECORDING_CONSTANTS = {
  // With compression (~23x), we can fit much more data per chunk.
  // 5000 samples × 8 floats × 8 bytes = 320KB raw → ~14KB compressed
  SAMPLES_PER_CHUNK: 5000,
  PREVIEW_POINTS: 100, // Downsampled preview quaternions per leg
  DEFAULT_SAMPLE_RATE: 100,
} as const;

export const COMPRESSION = {
  VERSION: "quant-delta-gzip-v1",
} as const;

export const INVITE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
} as const;

export const NOTIFICATION_TYPES = {
  SUBJECT_NOTE: "subject_note",
  RECORDING_SHARED: "recording_shared",
  INVITE_ACCEPTED: "invite_accepted",
  ADDED_AS_SUBJECT: "added_as_subject",
} as const;

export const RECORDING_SOURCES = {
  APP: "source:app",
  CSV: "source:csv",
} as const;

export const METRIC_STATUS = {
  PENDING: "pending",
  COMPUTING: "computing",
  COMPLETE: "complete",
  FAILED: "failed",
} as const;

export const MOVEMENT_TYPES = {
  BILATERAL: "bilateral",
  UNILATERAL: "unilateral",
  SINGLE_LEG: "single_leg",
  MIXED: "mixed",
  UNKNOWN: "unknown",
} as const;

export const SHOCK_ABSORPTION_QUALITY = {
  EXCELLENT: "excellent",
  GOOD: "good",
  POOR: "poor",
  ABSENT: "absent",
} as const;

export const ASYMMETRY_DIRECTION = {
  LEFT_DOMINANT: "left_dominant",
  RIGHT_DOMINANT: "right_dominant",
} as const;

export const ACTIVITY_PROFILES = {
  POWER: "power",
  ENDURANCE: "endurance",
  REHABILITATION: "rehabilitation",
  GENERAL: "general",
} as const;

export const OPI_DOMAINS = {
  SYMMETRY: "symmetry",
  POWER: "power",
  CONTROL: "control",
  STABILITY: "stability",
} as const;

export const OPI_GRADES = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  F: "F",
} as const;

// ─────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────

const roleValidator = v.union(
  v.literal(ROLES.PHYSIOTHERAPIST),
  v.literal(ROLES.PATIENT),
  v.literal(ROLES.ADMIN)
);

const inviteStatusValidator = v.union(
  v.literal(INVITE_STATUS.PENDING),
  v.literal(INVITE_STATUS.ACCEPTED),
  v.literal(INVITE_STATUS.EXPIRED)
);

const metricStatusValidator = v.union(
  v.literal(METRIC_STATUS.PENDING),
  v.literal(METRIC_STATUS.COMPUTING),
  v.literal(METRIC_STATUS.COMPLETE),
  v.literal(METRIC_STATUS.FAILED)
);

const movementTypeValidator = v.union(
  v.literal(MOVEMENT_TYPES.BILATERAL),
  v.literal(MOVEMENT_TYPES.UNILATERAL),
  v.literal(MOVEMENT_TYPES.SINGLE_LEG),
  v.literal(MOVEMENT_TYPES.MIXED),
  v.literal(MOVEMENT_TYPES.UNKNOWN)
);

const shockAbsorptionQualityValidator = v.union(
  v.literal(SHOCK_ABSORPTION_QUALITY.EXCELLENT),
  v.literal(SHOCK_ABSORPTION_QUALITY.GOOD),
  v.literal(SHOCK_ABSORPTION_QUALITY.POOR),
  v.literal(SHOCK_ABSORPTION_QUALITY.ABSENT)
);

const asymmetryDirectionValidator = v.union(
  v.literal(ASYMMETRY_DIRECTION.LEFT_DOMINANT),
  v.literal(ASYMMETRY_DIRECTION.RIGHT_DOMINANT)
);

const activityProfileValidator = v.union(
  v.literal(ACTIVITY_PROFILES.POWER),
  v.literal(ACTIVITY_PROFILES.ENDURANCE),
  v.literal(ACTIVITY_PROFILES.REHABILITATION),
  v.literal(ACTIVITY_PROFILES.GENERAL)
);

const opiDomainValidator = v.union(
  v.literal(OPI_DOMAINS.SYMMETRY),
  v.literal(OPI_DOMAINS.POWER),
  v.literal(OPI_DOMAINS.CONTROL),
  v.literal(OPI_DOMAINS.STABILITY)
);

const opiGradeValidator = v.union(
  v.literal(OPI_GRADES.A),
  v.literal(OPI_GRADES.B),
  v.literal(OPI_GRADES.C),
  v.literal(OPI_GRADES.D),
  v.literal(OPI_GRADES.F)
);

const opiMovementTypeValidator = v.union(
  v.literal("bilateral"),
  v.literal("unilateral")
);

// ─── Metric Validators ───

const perLegMetricsValidator = v.object({
  overallMaxROM: v.float64(),
  averageROM: v.float64(),
  peakFlexion: v.float64(),
  peakExtension: v.float64(),
  peakAngularVelocity: v.float64(),
  explosivenessLoading: v.float64(),
  explosivenessConcentric: v.float64(),
  rmsJerk: v.float64(),
  romCoV: v.float64(),
  peakResultantAcceleration: v.float64(),
});

const asymmetryIndicesValidator = v.object({
  overallMaxROM: v.float64(),
  averageROM: v.float64(),
  peakAngularVelocity: v.float64(),
  rmsJerk: v.float64(),
  explosivenessLoading: v.float64(),
  explosivenessConcentric: v.float64(),
});

const temporalAsymmetryValidator = v.object({
  phaseShift: v.float64(),
  crossCorrelation: v.float64(),
  temporalLag: v.float64(),
});

const bilateralAnalysisValidator = v.object({
  asymmetryIndices: asymmetryIndicesValidator,
  netGlobalAsymmetry: v.float64(),
  temporalAsymmetry: temporalAsymmetryValidator,
});

const unilateralMetricsValidator = v.object({
  flexorExtensorRatio: v.float64(),
  eccentricConcentricRatio: v.float64(),
});

const unilateralAnalysisValidator = v.object({
  left: unilateralMetricsValidator,
  right: unilateralMetricsValidator,
  bilateralRatioDiff: v.float64(),
});

const jumpMetricsValidator = v.object({
  groundContactTimeMs: v.float64(),
  flightTimeMs: v.float64(),
  jumpHeightCm: v.float64(),
  rsi: v.float64(),
});

const forcePowerMetricsValidator = v.object({
  eRFD: v.float64(),
  peakNormalizedForce: v.float64(),
  impulseEstimate: v.float64(),
});

const stiffnessMetricsValidator = v.object({
  legStiffness: v.float64(),
  verticalStiffness: v.float64(),
});

const smoothnessMetricsValidator = v.object({
  sparc: v.float64(),
  ldlj: v.float64(),
  nVelocityPeaks: v.float64(),
});

const shockAbsorptionResultValidator = v.object({
  score: v.float64(),
  doubleDipDetected: v.boolean(),
  patternQuality: shockAbsorptionQualityValidator,
});

const temporalCoordinationValidator = v.object({
  maxFlexionTimingDiff: v.float64(),
  zeroVelocityPhaseMs: v.float64(),
  shockAbsorption: shockAbsorptionResultValidator,
});

const gaitCycleMetricsValidator = v.object({
  stancePhasePct: v.float64(),
  swingPhasePct: v.float64(),
  dutyFactor: v.float64(),
  strideTimeMs: v.float64(),
});

const movementClassificationValidator = v.object({
  type: movementTypeValidator,
  confidence: v.float64(),
  correlationAtZero: v.float64(),
  optimalLag: v.float64(),
  optimalCorrelation: v.float64(),
  estimatedCycleSamples: v.float64(),
  phaseOffsetDegrees: v.float64(),
});

const transitionEventValidator = v.object({
  index: v.number(),
  timeMs: v.float64(),
  fromPhase: v.float64(),
  toPhase: v.float64(),
  fromType: movementTypeValidator,
  toType: movementTypeValidator,
});

const rollingPhaseResultValidator = v.object({
  phaseOffsetSeries: v.array(v.float64()),
  correlationSeries: v.array(v.float64()),
  windowCenters: v.array(v.number()),
  transitions: v.array(transitionEventValidator),
  dominantPhaseOffset: v.float64(),
});

const phaseCorrectedSignalsValidator = v.object({
  appliedShiftSamples: v.number(),
  appliedShiftMs: v.float64(),
  movementType: movementTypeValidator,
  requiresCorrection: v.boolean(),
});

const asymmetryEventValidator = v.object({
  startIndex: v.number(),
  endIndex: v.number(),
  startTimeMs: v.float64(),
  endTimeMs: v.float64(),
  durationMs: v.float64(),
  peakAsymmetry: v.float64(),
  avgAsymmetry: v.float64(),
  direction: asymmetryDirectionValidator,
  area: v.float64(),
});

const advancedAsymmetryResultValidator = v.object({
  phaseCorrection: phaseCorrectedSignalsValidator,
  asymmetryEvents: v.array(asymmetryEventValidator),
  avgBaselineOffset: v.float64(),
  avgRealAsymmetry: v.float64(),
  maxRealAsymmetry: v.float64(),
  totalAsymmetryDurationMs: v.float64(),
  asymmetryPercentage: v.float64(),
  baselineStability: v.float64(),
  signalToNoiseRatio: v.float64(),
});

const rollingAsymmetrySummaryValidator = v.object({
  avgAsymmetry: v.float64(),
  maxAsymmetry: v.float64(),
  timeInBilateral: v.float64(),
  timeInUnilateral: v.float64(),
  transitionCount: v.number(),
});

const rollingAsymmetryWindowValidator = v.object({
  windowCenter: v.number(),
  windowCenterMs: v.float64(),
  movementType: movementTypeValidator,
  phaseOffsetApplied: v.number(),
  avgAsymmetry: v.float64(),
  maxAsymmetry: v.float64(),
  baselineOffset: v.float64(),
});

const rollingAsymmetryResultValidator = v.object({
  windows: v.array(rollingAsymmetryWindowValidator),
  overallSummary: rollingAsymmetrySummaryValidator,
});

const phaseAlignmentResultValidator = v.object({
  optimalOffsetSamples: v.number(),
  optimalOffsetMs: v.float64(),
  optimalOffsetDegrees: v.float64(),
  alignedCorrelation: v.float64(),
  unalignedCorrelation: v.float64(),
  correlationImprovement: v.float64(),
});

// ─── OPI Validators ───

const opiConfidenceIntervalValidator = v.object({
  lower: v.float64(),
  upper: v.float64(),
});

const domainScoreContributorValidator = v.object({
  name: v.string(),
  raw: v.float64(),
  normalized: v.float64(),
  weight: v.float64(),
  citation: v.string(),
});

const domainScoreValidator = v.object({
  domain: opiDomainValidator,
  score: v.float64(),
  confidence: v.float64(),
  sem: v.float64(),
  contributors: v.array(domainScoreContributorValidator),
});

const opiResultValidator = v.object({
  overallScore: v.float64(),
  grade: opiGradeValidator,
  confidenceInterval: opiConfidenceIntervalValidator,
  sem: v.float64(),
  mdc95: v.float64(),
  domainScores: v.array(domainScoreValidator),
  strengths: v.array(v.string()),
  weaknesses: v.array(v.string()),
  clinicalFlags: v.array(v.string()),
  movementType: opiMovementTypeValidator,
  activityProfile: activityProfileValidator,
  dataCompleteness: v.float64(),
  methodologyCitations: v.array(v.string()),
});

// ─── Non-Metric Validators ───

const contactValidator = v.object({
  userId: v.id("users"),
  alias: v.optional(v.string()),
  addedAt: v.number(),
  starred: v.optional(v.boolean()),
});

const modificationDiffValidator = v.object({
  field: v.string(),
  old: v.any(),
  new: v.any(),
});

const modificationHistoryEntryValidator = v.object({
  modifiedAt: v.number(),
  modifiedBy: v.id("users"),
  diffs: v.array(modificationDiffValidator),
});

const subjectNoteValidator = v.object({
  userId: v.id("users"),
  note: v.string(),
  createdAt: v.number(), // Keep: embedded data, not a document
});

// Minified SVG paths for preview charts (x, y, z axis projections)
const previewPathsValidator = v.object({
  x: v.string(),
  y: v.string(),
  z: v.string(),
});

const softDeleteFields = {
  isArchived: v.optional(v.boolean()),
  archivedAt: v.optional(v.number()),
  archiveReason: v.optional(v.string()),
};

// Standard timestamp field - auto-set by triggers on every mutation
// Note: Cannot use underscore prefix (_modifiedAt) as Convex reserves _ for system fields
const timestampField = {
  modifiedAt: v.optional(v.number()),
};

// ─────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────

export default defineSchema({
  ...authTables,

  // ─── Users ───
  users: defineTable({
    // Profile (from Convex Auth via OAuth)
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),

    // Role
    role: v.optional(roleValidator),

    // Contacts
    contacts: v.optional(v.array(contactValidator)),

    // Settings
    emailNotifications: v.optional(v.boolean()),

    // Client-side cache encryption (KEK = Key Encryption Key)
    // KEK wraps the DEK (Data Encryption Key) stored locally on client
    kekWrapped: v.optional(v.string()), // Base64-encoded encrypted KEK
    kekVersion: v.optional(v.number()), // Rotation counter (increments on rotate)
    kekRotatedAt: v.optional(v.number()), // Timestamp of last rotation

    // Soft delete
    ...softDeleteFields,

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("email", ["email"])
    .index("by_role", ["role"])
    .index("by_archived", ["isArchived"]),

  // ─── Recording Sessions (Session Metadata + Preview) ───
  recordingSessions: defineTable({
    // Session Identity
    sessionId: v.string(),

    // Ownership & Access
    ownerId: v.id("users"),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
    sharedWith: v.optional(v.array(v.id("users"))),

    // Recording Metadata
    sampleRate: v.number(),
    totalSamples: v.number(),
    totalChunks: v.number(),
    activeJoints: v.array(v.string()),

    // Timing
    startTime: v.number(),
    endTime: v.number(),
    recordedAt: v.optional(v.number()), // Original capture time (for imports)

    // Minified SVG paths for instant chart preview (x, y, z axis projections)
    // ~500 bytes per leg, pre-rendered for zero client-side computation
    leftKneePaths: v.optional(previewPathsValidator),
    rightKneePaths: v.optional(previewPathsValidator),

    // Compression info
    compressionVersion: v.string(),

    // User Metadata
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjectNotes: v.optional(v.array(subjectNoteValidator)),
    activityProfile: v.optional(activityProfileValidator),

    // System Metadata
    systemTags: v.optional(v.array(v.string())),

    // Metrics status (denormalized for fast list queries)
    metricsStatus: v.optional(metricStatusValidator),

    // Audit Trail
    modificationHistory: v.optional(v.array(modificationHistoryEntryValidator)),

    // Soft Delete
    ...softDeleteFields,

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_owner", ["ownerId"])
    .index("by_subject", ["subjectId"])
    .index("by_archived", ["isArchived"])
    .searchIndex("search_sessions", {
      searchField: "notes",
      filterFields: ["ownerId", "subjectId", "isArchived"],
    }),

  // ─── Recording Chunks (Compressed Quaternion Data) ───
  recordingChunks: defineTable({
    // Session link
    sessionId: v.string(),
    chunkIndex: v.number(),

    // Chunk timing
    startTime: v.number(),
    endTime: v.number(),
    sampleCount: v.number(),

    // Compressed quaternion data (quant-delta-gzip-v1)
    leftKneeCompressed: v.optional(v.bytes()),
    rightKneeCompressed: v.optional(v.bytes()),

    // Sparse flags (still small, keep uncompressed)
    leftKneeInterpolated: v.array(v.number()),
    leftKneeMissing: v.array(v.number()),
    rightKneeInterpolated: v.array(v.number()),
    rightKneeMissing: v.array(v.number()),

    // Compression version for this chunk
    compressionVersion: v.string(),
  })
    .index("by_session", ["sessionId", "chunkIndex"]),

  // ─── Recording Metrics ───
  recordingMetrics: defineTable({
    // Session link
    sessionId: v.string(),

    // Computation status
    status: metricStatusValidator,
    computedAt: v.optional(v.number()),
    error: v.optional(v.string()),

    // Per-leg metrics (#1-11)
    leftLeg: v.optional(perLegMetricsValidator),
    rightLeg: v.optional(perLegMetricsValidator),

    // Bilateral analysis (#12-16)
    bilateralAnalysis: v.optional(bilateralAnalysisValidator),

    // Unilateral analysis (#17-19)
    unilateralAnalysis: v.optional(unilateralAnalysisValidator),

    // Jump metrics (#20-23) - TODO: review needed, angular accel derived
    jumpMetrics: v.optional(jumpMetricsValidator),

    // Force/power metrics (#24-26) - TODO: review needed, angular accel derived
    forcePowerMetrics: v.optional(forcePowerMetricsValidator),

    // Stiffness metrics (#27-28) - TODO: review needed, angular accel derived
    stiffnessMetrics: v.optional(stiffnessMetricsValidator),

    // Smoothness metrics (#29-31)
    smoothnessMetrics: v.optional(smoothnessMetricsValidator),

    // Temporal coordination (#32-34)
    temporalCoordination: v.optional(temporalCoordinationValidator),

    // Gait cycle metrics (#35-37) - TODO: review needed, angular accel derived
    gaitCycleMetrics: v.optional(gaitCycleMetricsValidator),

    // Movement classification (#38-39)
    movementClassification: v.optional(movementClassificationValidator),
    rollingPhase: v.optional(rollingPhaseResultValidator),

    // Advanced asymmetry (#40-41)
    advancedAsymmetry: v.optional(advancedAsymmetryResultValidator),
    rollingAsymmetry: v.optional(rollingAsymmetryResultValidator),

    // Phase alignment
    // defaultPhaseAlignment: the calculated optimal alignment (for reset)
    // phaseOffsetMs: the actual applied offset (can be manually adjusted)
    defaultPhaseAlignment: v.optional(phaseAlignmentResultValidator),
    phaseOffsetMs: v.optional(v.float64()),

    // Overall Performance Index (OPI)
    opiResult: v.optional(opiResultValidator),

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("by_session", ["sessionId"])
    .index("by_status", ["status"]),

  // ─── Invites ───
  invites: defineTable({
    fromUserId: v.id("users"),
    toEmail: v.string(),
    alias: v.optional(v.string()),
    token: v.string(),
    status: inviteStatusValidator,
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("by_token", ["token"])
    .index("by_from_user", ["fromUserId", "status"])
    .index("by_to_email", ["toEmail", "status"])
    .index("by_status", ["status", "expiresAt"]),

  // ─── Notifications ───
  notifications: defineTable({
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
    read: v.boolean(),

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "read"]),

  // ─── User Tags ───
  userTags: defineTable({
    userId: v.union(v.id("users"), v.literal("default")),
    tag: v.string(),
    category: v.optional(v.string()),
    lastUsedAt: v.number(),
    usageCount: v.number(),

    // Auto-updated timestamp
    ...timestampField,
  })
    .index("by_user", ["userId", "lastUsedAt"])
    .index("by_user_tag", ["userId", "tag"]),
});
