---
id: horus-findings-decomposition
tags: [horus, decomposition, architecture]
related_files: [/docs/horus-findings/README.md, /docs/horus-findings/checklist.md]
status: in-progress
last_sync: 2024-12-27
---

# Feature Decomposition: Enhanced Horus Findings

## Tree Structure

```
Enhanced Horus Findings System
├── 1. Frontend Primitives (shared building blocks)
│   ├── 1.1 ExpandableDetails ✓ atomic
│   │   - Collapsible section with evidence/implications/recommendations
│   ├── 1.2 ClassificationBadge ✓ atomic
│   │   - Strength/weakness badge with color coding
│   ├── 1.3 LimbBadge ✓ atomic
│   │   - "Left Leg" / "Right Leg" badge
│   ├── 1.4 BenchmarkBadge ✓ atomic
│   │   - Optimal/average/deficient indicator
│   ├── 1.5 DomainBadge ✓ atomic
│   │   - Range/symmetry/power/control/timing badge
│   └── 1.6 IconWrapper ✓ atomic
│       - Standardized icon sizing (sm/md/lg)
│
├── 2. Component Refactoring (consistency)
│   ├── 2.1 StatCard Enhancement
│   │   ├── 2.1.1 Add ComposableSlots interface ✓ atomic
│   │   ├── 2.1.2 Integrate ExpandableDetails ✓ atomic
│   │   ├── 2.1.3 Add badge slots (classification, limb, benchmark) ✓ atomic
│   │   └── 2.1.4 Standardize icon sizing ✓ atomic
│   ├── 2.2 AlertCard Enhancement
│   │   ├── 2.2.1 Rename severity → variant ✓ atomic
│   │   ├── 2.2.2 Add ComposableSlots ✓ atomic
│   │   ├── 2.2.3 Add ExpandableDetails ✓ atomic
│   │   └── 2.2.4 Standardize icon sizing ✓ atomic
│   ├── 2.3 ComparisonCard Enhancement
│   │   ├── 2.3.1 Add deficitLimb prop ✓ atomic
│   │   ├── 2.3.2 Add ComposableSlots ✓ atomic
│   │   ├── 2.3.3 Add ExpandableDetails ✓ atomic
│   │   └── 2.3.4 Highlight deficit limb visually ✓ atomic
│   ├── 2.4 MetricGrid Enhancement
│   │   ├── 2.4.1 Add per-item classification ✓ atomic
│   │   ├── 2.4.2 Add per-item benchmark ✓ atomic
│   │   └── 2.4.3 Add per-item limb ✓ atomic
│   ├── 2.5 QuoteCard Enhancement
│   │   ├── 2.5.1 Add id for correlation linking ✓ atomic
│   │   └── 2.5.2 Add domain badge ✓ atomic
│   ├── 2.6 ProgressCard Enhancement
│   │   ├── 2.6.1 Add ComposableSlots ✓ atomic
│   │   └── 2.6.2 Add limb badge ✓ atomic
│   └── 2.7 ExecutiveSummary Enhancement
│       └── 2.7.1 Add variant support ✓ atomic
│
├── 3. BlockRenderer Updates
│   ├── 3.1 Pass new slot props to components ✓ atomic
│   ├── 3.2 Handle expandable state ✓ atomic
│   └── 3.3 Evaluate details.metrics expressions ✓ atomic
│
├── 4. Backend Types & Schema
│   ├── 4.1 ComposableSlots Interface
│   │   ├── 4.1.1 Define ComposableSlots in types.ts ✓ atomic
│   │   ├── 4.1.2 Extend StatCardBlock interface ✓ atomic
│   │   ├── 4.1.3 Extend AlertCardBlock interface ✓ atomic
│   │   ├── 4.1.4 Extend ComparisonCardBlock interface ✓ atomic
│   │   ├── 4.1.5 Extend other block interfaces ✓ atomic
│   │   └── 4.1.6 Update VisualizationBlock union ✓ atomic
│   ├── 4.2 LLM Schema Updates
│   │   ├── 4.2.1 Add optional slots to STAT_CARD_BLOCK ✓ atomic
│   │   ├── 4.2.2 Add optional slots to ALERT_CARD_BLOCK ✓ atomic
│   │   ├── 4.2.3 Add optional slots to COMPARISON_CARD_BLOCK ✓ atomic
│   │   └── 4.2.4 Add optional slots to other schemas ✓ atomic
│   └── 4.3 Progress Types
│       ├── 4.3.1 Add ProgressCorrelation interface ✓ atomic
│       └── 4.3.2 Add AsymmetryTrend interface ✓ atomic
│
├── 5. Correlation Module (NEW)
│   ├── 5.1 computeAsymmetryEnrichment() ✓ atomic
│   │   - Pre-compute asymmetry for all per-leg metrics
│   │   - Identify deficit limb using calculateAsymmetry()
│   │   - Flag significant (>5%) and critical (>15%)
│   ├── 5.2 identifyPotentialCorrelations() ✓ atomic
│   │   - Find limb-consistent patterns
│   │   - Cross-domain correlations
│   │   - Symmetry + timing relationships
│   └── 5.3 generateCorrelationPromptSection() ✓ atomic
│       - Format for AI prompt injection
│
├── 6. Prompt Engineering
│   ├── 6.1 Analysis Prompt Updates
│   │   ├── 6.1.1 Add composable slot examples ✓ atomic
│   │   ├── 6.1.2 Add limb specificity rules ✓ atomic
│   │   ├── 6.1.3 Inject correlation data ✓ atomic
│   │   └── 6.1.4 Add bad examples to avoid ✓ atomic
│   ├── 6.2 Progress Prompt Updates
│   │   ├── 6.2.1 Add cross-metric correlation guidance ✓ atomic
│   │   └── 6.2.2 Add asymmetry trend tracking ✓ atomic
│   └── 6.3 Catalog Updates
│       ├── 6.3.1 Document new slot options ✓ atomic
│       └── 6.3.2 Add usage examples ✓ atomic
│
└── 7. Testing & Validation
    ├── 7.1 Verify backward compatibility ✓ atomic
    ├── 7.2 Test slot rendering ✓ atomic
    ├── 7.3 Re-run analysis on existing session ✓ atomic
    └── 7.4 Validate limb specificity in output ✓ atomic
```

## Atomic Units (Flat List)

### Phase 1: Frontend Primitives
1. **ExpandableDetails** - Collapsible details section component
2. **ClassificationBadge** - Strength/weakness badge
3. **LimbBadge** - Left Leg/Right Leg badge
4. **BenchmarkBadge** - Optimal/average/deficient badge
5. **DomainBadge** - Domain indicator badge
6. **IconWrapper** - Standardized icon sizing

### Phase 2: Component Refactoring
7. **StatCard.slots** - Add ComposableSlots to StatCard
8. **StatCard.expandable** - Integrate ExpandableDetails
9. **StatCard.badges** - Add badge slots
10. **StatCard.icons** - Standardize icon sizing
11. **AlertCard.variant** - Rename severity → variant
12. **AlertCard.slots** - Add ComposableSlots
13. **AlertCard.expandable** - Add ExpandableDetails
14. **AlertCard.icons** - Standardize icon sizing
15. **ComparisonCard.deficitLimb** - Add deficitLimb prop
16. **ComparisonCard.slots** - Add ComposableSlots
17. **ComparisonCard.expandable** - Add ExpandableDetails
18. **ComparisonCard.highlight** - Highlight deficit limb
19. **MetricGrid.itemClassification** - Per-item classification
20. **MetricGrid.itemBenchmark** - Per-item benchmark
21. **MetricGrid.itemLimb** - Per-item limb
22. **QuoteCard.id** - Add id for linking
23. **QuoteCard.domain** - Add domain badge
24. **ProgressCard.slots** - Add ComposableSlots
25. **ProgressCard.limb** - Add limb badge
26. **ExecutiveSummary.variant** - Add variant support

### Phase 3: BlockRenderer
27. **BlockRenderer.slotProps** - Pass new props
28. **BlockRenderer.expandable** - Handle expandable state
29. **BlockRenderer.metricsEval** - Evaluate details.metrics

### Phase 4: Backend Types
30. **types.ComposableSlots** - Define interface
31. **types.StatCardBlock** - Extend with slots
32. **types.AlertCardBlock** - Extend with slots
33. **types.ComparisonCardBlock** - Extend with slots
34. **types.OtherBlocks** - Extend remaining
35. **types.VisualizationBlock** - Update union
36. **schemas.StatCard** - Add optional slots
37. **schemas.AlertCard** - Add optional slots
38. **schemas.ComparisonCard** - Add optional slots
39. **schemas.OtherSchemas** - Add to remaining
40. **types.ProgressCorrelation** - New interface
41. **types.AsymmetryTrend** - New interface

### Phase 5: Correlation Module
42. **correlation.asymmetryEnrichment** - computeAsymmetryEnrichment()
43. **correlation.potentialCorrelations** - identifyPotentialCorrelations()
44. **correlation.promptSection** - generateCorrelationPromptSection()

### Phase 6: Prompt Engineering
45. **prompts.slotExamples** - Add slot examples
46. **prompts.limbRules** - Limb specificity rules
47. **prompts.correlationInjection** - Inject correlation data
48. **prompts.badExamples** - Examples to avoid
49. **prompts.progressCorrelation** - Cross-metric guidance
50. **prompts.asymmetryTrends** - Asymmetry tracking
51. **catalog.slotDocs** - Document slots
52. **catalog.usageExamples** - Usage examples

### Phase 7: Testing
53. **test.backwardCompat** - Verify old blocks work
54. **test.slotRendering** - Test slot rendering
55. **test.rerunAnalysis** - Re-run on existing session
56. **test.limbSpecificity** - Validate limb naming

## Dependencies

```
Phase 1 (Primitives) → Phase 2 (Components) → Phase 3 (BlockRenderer)
                                ↓
Phase 4 (Types/Schema) → Phase 5 (Correlation) → Phase 6 (Prompts)
                                                        ↓
                                                 Phase 7 (Testing)
```

## Estimated Scope

- **56 atomic units**
- **7 phases**
- **Frontend-first approach** (Phases 1-3 before 4-6)
