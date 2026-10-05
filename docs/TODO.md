# TODO

Two deliberate trade-offs. Each has a named upgrade path. These are not placeholders for things we meant to do but didn't; they are shortcuts with a known ceiling.

## 1. LLM-judge calibrated only on 20-row gold sets per judged scenario

**Ceiling.** 95% CI around judge accuracy is wide (±0.18 at N=20). The number is directional, not definitive.

**Upgrade path.** Expand gold sets to 100 rows per scenario when the next 10 scenarios land. Add inter-rater reliability with a second human labeler.

## 2. Vector search uses pgvector with naive chunking (1k chars, 200 overlap), no reranker

**Ceiling.** 500 docs. Recall is fine at this scale, but precision falls off above ~5k docs or when queries share surface tokens across tenants.

**Upgrade path.** Add rerank behind the `search_knowledge_base` tool signature. Interface stays unchanged; swap pgvector-only for pgvector + Cohere / bge-reranker inside the tool.

## What was NOT chosen as a TODO

Dropped from v1 strategy:

- "Prompt-based injection guardrail instead of fine-tuned" — adversarial pass flagged this as "obvious thing not done" dressed up as trade-off.
- "Single-region deploy" — same category. Shipping single-region is a decision, not a trade-off; it goes in README's known trade-offs, not here.
