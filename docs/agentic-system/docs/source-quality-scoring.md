# Source Quality Scoring System

This document details the algorithm for rating research source quality in the TropX Agentic Analysis System.

## Overview

Every research source is assigned:
1. A **Quality Tier** (S, A, B, C, D) for quick reference
2. A **Quality Score** (0-100) for precise ranking
3. **Quality Factors** breakdown for transparency

## Quality Tiers

| Tier | Score Range | Description | Trust Level |
|------|-------------|-------------|-------------|
| S | 90-100 | Gold standard evidence | Can be cited definitively |
| A | 75-89 | High quality research | Strong support for claims |
| B | 60-74 | Moderate quality | Good supporting evidence |
| C | 40-59 | Limited quality | Use with caveats |
| D | 20-39 | Low quality | Mention only if nothing better |

## Scoring Formula

```
quality_score = (
  source_authority    × 0.30 +
  publication_type    × 0.25 +
  recency             × 0.20 +
  relevance_to_query  × 0.15 +
  citation_impact     × 0.10
)
```

## Factor 1: Source Authority (30%)

Evaluates the reputation and reliability of the publishing domain/organization.

### Domain Authority Scores

| Score | Domain Type | Examples |
|-------|-------------|----------|
| 100 | Primary medical databases | pubmed.ncbi.nlm.nih.gov, cochranelibrary.com |
| 95 | Major medical journals | nejm.org, bmj.com, thelancet.com |
| 90 | Sports medicine journals | bjsm.bmj.com, jospt.org, ajsm.org |
| 85 | Professional organizations | apta.org, acsm.org, aaos.org |
| 80 | University medical centers | hopkinsmedicine.org, mayoclinic.org |
| 75 | Rehabilitation journals | archives-pmr.org, physical-therapy.org |
| 70 | Medical education sites | physio-pedia.com, sportsmedtoday.com |
| 60 | Government health sites | nih.gov, cdc.gov |
| 50 | General medical reference | webmd.com (with professional oversight) |
| 40 | Health news sites | healthline.com, medicalnewstoday.com |
| 30 | Professional blogs | Verified PT/MD authors with credentials |
| 20 | General health blogs | Non-credentialed authors |
| 10 | Forums/social media | reddit.com, patient forums |

### Authority Verification Checklist

Before assigning authority score, verify:
- [ ] Is the domain a recognized publisher?
- [ ] Are there editorial standards?
- [ ] Is content peer-reviewed?
- [ ] Are author credentials visible?
- [ ] Is the organization reputable?

## Factor 2: Publication Type (25%)

Evaluates the study design and methodology hierarchy.

### Evidence Hierarchy Scores

| Score | Publication Type | Description |
|-------|-----------------|-------------|
| 100 | Meta-analysis | Statistical synthesis of multiple studies |
| 95 | Systematic review | Comprehensive literature review with methodology |
| 90 | Randomized controlled trial (RCT) | Experimental design with randomization |
| 85 | Controlled clinical trial | Experimental without randomization |
| 80 | Prospective cohort study | Follow participants forward in time |
| 75 | Retrospective cohort study | Look back at existing data |
| 70 | Case-control study | Compare cases to matched controls |
| 65 | Cross-sectional study | Single time-point observation |
| 60 | Case series (n > 10) | Multiple case descriptions |
| 50 | Clinical practice guideline | Expert consensus recommendations |
| 45 | Narrative review | Non-systematic literature summary |
| 40 | Expert opinion/editorial | Published professional opinions |
| 35 | Textbook chapter | Educational reference |
| 30 | Case report | Single case description |
| 25 | Conference abstract | Preliminary findings |
| 20 | News article | Journalism about research |
| 15 | Blog post | Informal professional content |
| 10 | Forum/Q&A | Community discussions |

### Publication Type Detection

Indicators to identify publication type:
- **Meta-analysis**: Contains "meta-analysis" in title, forest plots, I² statistics
- **Systematic review**: PRISMA flowchart, search strategy described
- **RCT**: Random allocation, control group, blinding mentioned
- **Cohort**: Follows groups over time, hazard ratios
- **Case-control**: Compares cases to controls, odds ratios
- **Guideline**: "Recommendation", "Guideline", grade of evidence

## Factor 3: Recency (20%)

Evaluates how current the information is.

### Recency Score Calculation

```javascript
function calculateRecencyScore(publicationDate) {
  const ageInYears = (Date.now() - publicationDate) / (365.25 * 24 * 60 * 60 * 1000);

  if (ageInYears <= 1) return 100;
  if (ageInYears <= 2) return 95;
  if (ageInYears <= 3) return 85;
  if (ageInYears <= 5) return 75;
  if (ageInYears <= 7) return 65;
  if (ageInYears <= 10) return 55;
  if (ageInYears <= 15) return 45;
  return 40; // Floor for seminal papers
}
```

### Recency Adjustments

**Boost for foundational papers** (+15):
- Seminal works that defined a field
- Papers with >1000 citations
- Works referenced in clinical guidelines

**Penalty for rapidly evolving topics** (-10):
- Surgical techniques (technology changes)
- Diagnostic criteria (may be outdated)
- Pharmacological interventions

**Neutral for stable topics**:
- Basic biomechanics
- Anatomy
- Fundamental exercise principles

## Factor 4: Relevance to Query (15%)

Evaluates how directly the source addresses the specific pattern/question.

### Relevance Score Assignment

| Score | Relevance Level | Description |
|-------|-----------------|-------------|
| 100 | Direct match | Directly studies the exact pattern/metric |
| 85 | Close match | Studies the same body part and similar metric |
| 70 | Related | Same body region, related concept |
| 55 | Tangential | General biomechanics principles that apply |
| 40 | Indirect | Only loosely connected |
| 20 | Weak | Connection requires inference |

### Relevance Indicators

**High relevance signals**:
- Pattern keywords in title/abstract
- Same body region (knee, lower extremity)
- Same population (rehabilitation, athletes)
- Same activity type (squat, gait, jump)
- Same metric type (ROM, asymmetry, velocity)

**Low relevance signals**:
- Different body region
- Different population (pediatric when patient is adult)
- Different context (elite sport when patient is recreational)
- Theoretical without clinical application

## Factor 5: Citation Impact (10%)

Evaluates influence based on citation count.

### Citation Score Calculation

```javascript
function calculateCitationScore(citations, ageInYears) {
  // Normalize for age (expected citations per year)
  const citationsPerYear = citations / Math.max(ageInYears, 1);

  // Thresholds for biomechanics/rehabilitation field
  if (citationsPerYear >= 50) return 100;  // Highly influential
  if (citationsPerYear >= 30) return 90;
  if (citationsPerYear >= 20) return 80;
  if (citationsPerYear >= 10) return 70;
  if (citationsPerYear >= 5) return 60;
  if (citationsPerYear >= 2) return 50;
  if (citationsPerYear >= 1) return 40;
  return 30; // New or low-impact
}
```

### When Citation Data is Unavailable

If citations cannot be retrieved:
- Use journal impact factor as proxy (if available)
- Default to 50 (neutral)
- Flag as "citation_data_missing"

## Complete Scoring Example

### Source: "Limb Symmetry Index Thresholds for Return to Sport"

| Factor | Raw Value | Score | Weight | Contribution |
|--------|-----------|-------|--------|--------------|
| Source Authority | JOSPT (sports medicine journal) | 90 | 0.30 | 27.0 |
| Publication Type | Prospective cohort (n=156) | 80 | 0.25 | 20.0 |
| Recency | 2021 (4 years old) | 75 | 0.20 | 15.0 |
| Relevance | Direct study of LSI thresholds | 95 | 0.15 | 14.25 |
| Citations | 89 citations in 4 years (~22/yr) | 80 | 0.10 | 8.0 |

**Total Score: 84.25 → Tier A**

### Source: "Blog Post: Understanding Knee Asymmetry"

| Factor | Raw Value | Score | Weight | Contribution |
|--------|-----------|-------|--------|--------------|
| Source Authority | PT blog (credentials verified) | 30 | 0.30 | 9.0 |
| Publication Type | Blog post | 15 | 0.25 | 3.75 |
| Recency | 2024 (current) | 100 | 0.20 | 20.0 |
| Relevance | Discusses knee asymmetry general | 70 | 0.15 | 10.5 |
| Citations | N/A | 50 | 0.10 | 5.0 |

**Total Score: 48.25 → Tier C**

## Implementation

### TypeScript Interface

```typescript
interface QualityAssessment {
  qualityTier: 'S' | 'A' | 'B' | 'C' | 'D';
  qualityScore: number;
  qualityFactors: {
    sourceAuthority: number;
    publicationType: number;
    recency: number;
    relevanceToQuery: number;
    citationImpact: number;
  };
  assessmentNotes?: string[];
}

function assessSourceQuality(
  source: ResearchSource,
  queryContext: QueryContext
): QualityAssessment {
  const factors = {
    sourceAuthority: assessDomainAuthority(source.domain),
    publicationType: assessPublicationType(source.type, source.metadata),
    recency: assessRecency(source.publicationDate),
    relevanceToQuery: assessRelevance(source.content, queryContext),
    citationImpact: assessCitations(source.citations, source.publicationDate),
  };

  const score =
    factors.sourceAuthority * 0.30 +
    factors.publicationType * 0.25 +
    factors.recency * 0.20 +
    factors.relevanceToQuery * 0.15 +
    factors.citationImpact * 0.10;

  return {
    qualityTier: scoreToTier(score),
    qualityScore: Math.round(score),
    qualityFactors: factors,
  };
}

function scoreToTier(score: number): QualityTier {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}
```

## Domain Allowlist

### Tier S-A Domains (Prioritize)
```
pubmed.ncbi.nlm.nih.gov
cochranelibrary.com
jospt.org
bjsm.bmj.com
ajsm.org
apta.org
acsm.org
journals.lww.com/acsm-msse
springer.com
wiley.com/physical-therapy
```

### Tier B Domains (Include)
```
physio-pedia.com
sportsmedtoday.com
hopkinsmedicine.org
mayoclinic.org
clevelandclinic.org
nih.gov
cdc.gov
sciencedirect.com
```

### Tier C-D Domains (Use Cautiously)
```
healthline.com
medicalnewstoday.com
verywellhealth.com
physionetwork.com
```

### Blocked Domains (Never Use)
```
wikipedia.org (use as starting point only, never cite)
answers.com
quora.com
reddit.com
facebook.com
instagram.com
tiktok.com
```

## Quality Decay Over Time

Cached research entries should have their quality score decayed based on:

```javascript
function decayQualityScore(entry: CachedResearch): number {
  const monthsSinceCached = getMonthsSince(entry.lastVerifiedAt);

  // No decay for first 3 months
  if (monthsSinceCached <= 3) return entry.qualityScore;

  // Linear decay: -1 point per month after 3 months
  const decay = Math.min(monthsSinceCached - 3, 20); // Cap at -20

  return Math.max(entry.qualityScore - decay, 20); // Floor at 20
}
```

## Re-verification Triggers

Research cache entries should be re-verified when:
1. Quality score drops below next tier threshold
2. Entry is older than 6 months
3. Entry is accessed but hasn't been verified in 3 months
4. Manual flag raised for outdated information

Re-verification process:
1. Attempt to fetch URL and confirm content still exists
2. Check if content has been updated (compare hash or date)
3. If updated, re-score the new content
4. If URL dead, mark entry as stale and search for replacement
