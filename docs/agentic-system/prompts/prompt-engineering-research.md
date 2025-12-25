# Prompt Engineering Research Summary

## Key Research Findings

### 1. Chain-of-Thought (CoT) Prompting

**Source**: [Wei et al. (2022) - Chain-of-Thought Prompting Elicits Reasoning](https://arxiv.org/abs/2201.11903)

**Key Finding**: Step-by-step reasoning dramatically improves accuracy.
- **90.2% accuracy** on math/reasoning tasks with PaLM 540B (vs ~17% without CoT)
- **39% improvement** on mathematical problem solving
- **26% improvement** on commonsense reasoning

**Best Trigger Phrase**: "Let's think step by step" (Zhang et al. 2022)

### 2. Self-Consistency

**Technique**: Generate multiple reasoning paths, select most common conclusion.

**Improvements over baseline CoT**:
- +17.9% on GSM8K
- +11.0% on SVAMP
- +12.2% on AQuA

### 3. Tree-of-Thoughts (ToT)

**Technique**: Hierarchical reasoning with backtracking and path evaluation.

**Result**: **74% success rate** on Game of 24 vs CoT's 4%

### 4. Program of Thoughts (PoT)

**Technique**: Use executable code for numerical reasoning instead of natural language.

**Result**: ~12% improvement over CoT on numerical tasks

### 5. Google DeepMind's OPRO

**Source**: [OPRO: Optimization by PROmpting](https://jrodthoughts.medium.com/meet-opro-google-deepminds-new-method-that-optimizes-prompts-better-than-humans-4b840655b995)

**Key Finding**: AI-optimized prompts outperform human prompts by **50%+** in testing.

**Meta-Prompt Algorithm**:
1. Retrospect past prompts
2. Evaluate effectiveness
3. Spawn new prompts to test
4. Iterate until optimal

---

## Best Practices for Algorithmic Prompts

### Structure (Google's Whitepaper)

**Source**: [Google Prompt Engineering Guide](https://developers.google.com/machine-learning/resources/prompt-eng)

```
1. ROLE DEFINITION     → Who is the model?
2. CONTEXT/INPUT DATA  → What information does it have?
3. INSTRUCTION         → What should it do?
4. OUTPUT FORMAT       → How should it respond?
5. CONSTRAINTS         → What should it avoid?
6. EXAMPLES            → Show desired output format
```

### Algorithm-Like Prompting Pattern

Research shows prompts with explicit algorithmic structure outperform vague instructions:

```
## BAD (Vague)
"Analyze the metrics and find patterns."

## GOOD (Algorithmic)
"STEP 1: For each metric, compare left vs right leg values.
 STEP 2: If |left - right| > threshold, flag as asymmetry.
 STEP 3: For each flagged asymmetry, determine which leg is affected.
 STEP 4: Classify severity: <10% mild, 10-20% moderate, >20% severe.
 STEP 5: Output the finding with the specific leg name."
```

### Key Accuracy Boosters

| Technique | Improvement | When to Use |
|-----------|-------------|-------------|
| Step-by-step instructions | +26-39% | All complex reasoning |
| Few-shot examples | +15-25% | Structured output tasks |
| Self-consistency (multiple runs) | +11-18% | High-stakes decisions |
| Explicit verification steps | +7-27% | Fact-checking, validation |
| Constraints/boundaries | Reduces hallucination | Medical/clinical domains |

---

## Structured Output Best Practices

**Source**: [OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)

### Key Findings

- JSON schema compliance: **100%** with structured mode vs **35%** with prompting alone
- Format bias: LLMs perform better with JSON than YAML (more training data)

### Implementation Recommendations

1. **Provide explicit JSON schema** in the prompt
2. **Use Pydantic/Zod** for type validation
3. **Include example outputs** showing exact format
4. **Validate output** against schema before use
5. **Break complex schemas** into nested objects

### Gemini Structured Output

Gemini 2.0 supports structured output via `response_schema`:

```typescript
const result = await model.generateContent({
  contents: [...],
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        findings: { type: "array", items: {...} },
        recommendations: { type: "array", items: {...} }
      },
      required: ["findings", "recommendations"]
    }
  }
});
```

---

## Application to TropX Analysis Agent

### Prompt Design Principles

1. **Algorithmic Structure**: Every analysis step explicitly defined
2. **Side Specificity**: Force explicit limb naming in output schema
3. **Classification Requirements**: Schema enforces Strength/Weakness tagging
4. **Normative Benchmarking**: Reference existing thresholds in prompt
5. **Correlative Insights**: Dedicated algorithm section for cross-metric analysis

### Verification Loop

Based on self-consistency research, the validation loop should:
1. Check numerical accuracy
2. Verify all findings have explicit side labels
3. Confirm Strength/Weakness classification for every metric
4. Validate chart data matches findings

---

## Sources

- [Systematic Survey of Prompt Engineering (2024)](https://arxiv.org/html/2402.07927v1)
- [Chain-of-Thought Prompting Guide](https://www.promptingguide.ai/techniques/cot)
- [Google Prompt Engineering Whitepaper](https://developers.google.com/machine-learning/resources/prompt-eng)
- [OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/)
- [Google DeepMind OPRO](https://jrodthoughts.medium.com/meet-opro-google-deepminds-new-method-that-optimizes-prompts-better-than-humans-4b840655b995)
