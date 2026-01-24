/**
 * Horus v2 Web Search Utilities
 *
 * Domain tier mapping and evidence quality utilities.
 * Note: Web search is now handled by Gemini's built-in Google Search grounding
 * via callVertexAIGrounded. These utilities are used for categorizing results.
 */

import type { EvidenceTier } from "../types";

// ─────────────────────────────────────────────────────────────────
// Domain Tier Mapping
// ─────────────────────────────────────────────────────────────────

/**
 * Domain tier mapping for evidence quality.
 * Higher tiers = more authoritative medical sources.
 */
const DOMAIN_TIERS: Record<string, EvidenceTier> = {
  // S-Tier: Systematic reviews, meta-analyses
  "cochranelibrary.com": "S",
  "cochrane.org": "S",

  // A-Tier: Primary research, major medical databases
  "pubmed.ncbi.nlm.nih.gov": "A",
  "ncbi.nlm.nih.gov": "A",
  "jamanetwork.com": "A",
  "nejm.org": "A",
  "bmj.com": "A",
  "thelancet.com": "A",
  "nature.com": "A",
  "sciencedirect.com": "A",
  "springer.com": "A",
  "wiley.com": "A",

  // B-Tier: Clinical guidelines, expert consensus
  "physio-pedia.com": "B",
  "apta.org": "B",
  "jospt.org": "B",
  "orthobullets.com": "B",
  "uptodate.com": "B",
  "mayoclinic.org": "B",
  "clevelandclinic.org": "B",
  "hopkinsmedicine.org": "B",
  "aaos.org": "B",
  "who.int": "B",

  // C-Tier: Educational, professional sources
  "physiopedia.com": "C",
  "kenhub.com": "C",
  "teachmeanatomy.info": "C",
  "healthline.com": "C",
  "webmd.com": "C",
  "verywellhealth.com": "C",
  "medicalnewstoday.com": "C",
};

// ─────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Get evidence tier for a URL based on domain.
 */
export function getTierForUrl(url: string): EvidenceTier {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");

    // Check exact domain match
    if (hostname in DOMAIN_TIERS) {
      return DOMAIN_TIERS[hostname];
    }

    // Check if domain ends with any known domain
    for (const [domain, tier] of Object.entries(DOMAIN_TIERS)) {
      if (hostname.endsWith(domain)) {
        return tier;
      }
    }

    // Default to D tier for unknown sources
    return "D";
  } catch {
    return "D";
  }
}

/**
 * Filter results to only include high-quality sources (tier B or better).
 */
export function filterHighQualityResults<T extends { tier: EvidenceTier }>(
  results: T[]
): T[] {
  const highQualityTiers: EvidenceTier[] = ["S", "A", "B"];
  return results.filter((result) => highQualityTiers.includes(result.tier));
}

/**
 * Get best result for each tier (for diverse evidence).
 */
export function getDiverseResults<T extends { tier: EvidenceTier }>(
  results: T[],
  maxPerTier: number = 2
): T[] {
  const byTier: Record<EvidenceTier, T[]> = {
    S: [],
    A: [],
    B: [],
    C: [],
    D: [],
  };

  for (const result of results) {
    if (byTier[result.tier].length < maxPerTier) {
      byTier[result.tier].push(result);
    }
  }

  return [...byTier.S, ...byTier.A, ...byTier.B, ...byTier.C, ...byTier.D];
}
