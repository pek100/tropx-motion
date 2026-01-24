/**
 * Horus Primitives
 *
 * Shared building blocks for composable cards.
 * ShadCN-style primitives that AI can compose into rich findings.
 */

// ─────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────

export { ExpandableDetails } from "./ExpandableDetails";
export { ClassificationBadge } from "./ClassificationBadge";
export { LimbBadge } from "./LimbBadge";
export { BenchmarkBadge } from "./BenchmarkBadge";
export { DomainBadge } from "./DomainBadge";
export { EvidenceTierBadge } from "./EvidenceTierBadge";
export { IconWrapper, getIconSizeClass } from "./IconWrapper";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type { DetailsSlot } from "./ExpandableDetails";
export type { Classification } from "./ClassificationBadge";
export type { Limb } from "./LimbBadge";
export type { Benchmark } from "./BenchmarkBadge";
export type { MetricDomain } from "./DomainBadge";
export type { EvidenceTier } from "./EvidenceTierBadge";
export type { IconSize } from "./IconWrapper";
