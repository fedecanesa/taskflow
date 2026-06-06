# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`taskflow` is a small learning/experimentation project (labeled "Lab 1" in code) for comparing LLMs across providers. It contains a single script, `ab-test.js`, that benchmarks Anthropic models (Haiku, Sonnet) against OpenAI (GPT-4o-mini) on an "executive project summaries" task (prompts and outputs are in Spanish), measuring latency, token usage and cost.

ES modules are used throughout (`"type": "module"` in `package.json`).

## Commands

There is no build step and no test runner (`npm test` is a placeholder that exits 1). Run the script directly:

```bash
node ab-test.js
```

This calls the live Anthropic and OpenAI APIs for each model × each item, prints per-item latency/token/cost output, a comparison table, and an ASCII bar chart of cost vs. latency. It overwrites three output files with the summary rows: `ab-results.json`, `ab-results.csv`, and the on-screen chart (not persisted).

## Configuration

- Requires `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env` (loaded via `dotenv/config`; the `Anthropic()` and `OpenAI()` clients each read their key from the environment automatically). `.env` is gitignored.
- `.env` also defines `AI_MODEL`, but it is **not** used by `ab-test.js` (models are hardcoded in `MODELS`) — leftover scaffolding.

## Architecture notes

`ab-test.js` is self-contained. Key things to keep in sync when editing:

- Each entry in `MODELS` is a `{ name, provider }` object where `provider` is `"anthropic"` or `"openai"`. `generate()` routes on `provider` to either `generateAnthropic()` or `generateOpenAI()`; adding a new provider means adding a `generate*()` helper and a branch in `generate()`.
- Provider call shapes differ and are normalized inside the helpers: Anthropic takes `system` as a top-level param and returns tokens in `usage.input_tokens` / `output_tokens`; OpenAI passes `system` as the first chat message and returns `usage.prompt_tokens` / `completion_tokens`. Both helpers return a uniform `{ text, inTok, outTok, cacheRead, cacheCreate }` (OpenAI hardcodes the cache fields to 0).
- The Anthropic `system` block carries `cache_control: { type: "ephemeral" }` for prompt caching, and the run reports `cache_read_input_tokens` / `cache_creation_input_tokens`. **Caching does not actually engage here**: the system prompt is ~50 tokens, far below Anthropic's minimum cacheable prefix (4096 tokens on Haiku 4.5, 2048 on Sonnet 4.6), so the cache columns are always 0. The wiring is correct and would activate with a large enough shared prefix.
- `MODELS` and `PRICES` (USD per million input/output tokens) must stay aligned — `costUSD()` looks up each model `name` in `PRICES`, so adding a model without a matching `PRICES` entry will throw. `costUSD()` prices cached input at `CACHE_READ_MULT` (0.1×) and cache writes at `CACHE_WRITE_MULT` (1.25×); `MAX_TOKENS` (180) caps output, sized to a ~90-word summary.
- `PRICES` values are hardcoded and must be manually verified against current Anthropic/OpenAI pricing; reported costs are only as accurate as these constants.
- The benchmark is a nested loop over `MODELS` then `ITEMS`, accumulating latency/tokens/cost; `cost_per_1k_items_usd` extrapolates the per-run average to 1,000 items.
- After building `rows`, `main()` writes `ab-results.json` and `ab-results.csv` (kept in sync — adding a column means updating both the CSV header and the row template; rows also carry `cache_read_tok`, `cache_write_tok`, and `saving_usd`) and prints the ASCII bar chart. The chart uses fixed scale factors (`cost * 5000`, `avg_ms / 200`) per character, so cost and latency bars are not comparable to each other, only across models.
