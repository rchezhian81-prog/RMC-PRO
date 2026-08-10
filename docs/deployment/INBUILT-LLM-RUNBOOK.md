# Inbuilt (Self-Hosted) AI Model Runbook

> How to run the multi-agent system's reasoning on a model **you host** — no
> subscription, no per-token bill, no data leaving your server. This is the
> default. The paid Anthropic API is strictly opt-in.
>
> Companion: `docs/audit/MULTI_AGENT_SYSTEM_ARCHITECTURE.md`. Provider code:
> `apps/api/src/agents/llm/local.provider.ts`.

## 1. How it fits (nothing is subscription-locked)

The 5 agents run in **two layers**:

- **Deterministic (always on, free, instant).** KPIs, alerts, compliance prep,
  approvals — pure rule-based logic, no model, no network. This is the baseline
  and needs nothing configured.
- **Inbuilt model (optional reasoning/chat).** The `/agents/:name/ask` path and
  `ctx.reason()` call a model **you host**, through the OpenAI-compatible API that
  every common local server speaks. The model only *proposes* tool calls; the
  guardrail funnel (scope → policy → budget → tenant → audit) still enforces
  everything.

If no local model is configured, the model layer is simply **off** and the
deterministic agents carry on — so the plant always works, at zero cost.

## 2. Pick a runtime + model (on your VPS)

Any server that exposes the OpenAI `/v1/chat/completions` API works. Easiest:

**Ollama** (simplest):
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve                 # exposes http://127.0.0.1:11434
ollama pull qwen2.5:7b-instruct
```
Ollama's OpenAI-compatible base URL is `http://127.0.0.1:11434/v1`.

**llama.cpp** (leanest): run `llama-server -m model.gguf --port 8080` → base URL
`http://127.0.0.1:8080/v1`.

**Model choice — pick one that supports tool/function calling** (the agents rely
on it). Good CPU-friendly options, in rough capability order:
- `qwen2.5:7b-instruct` — strong tool use, ~5–6 GB RAM quantized (recommended start).
- `llama3.1:8b-instruct` — solid, widely supported.
- `mistral-nemo` / `qwen2.5:3b-instruct` — lighter, faster, weaker reasoning.

## 3. Resource reality (read before choosing)

- A 7–8B model quantized (Q4) needs **~5–8 GB RAM**. Confirm your VPS has the
  headroom over Postgres + the API.
- **CPU-only inference is slow** — expect several seconds to tens of seconds per
  reply for a 7B model. Fine for on-demand `/ask` and back-office reasoning; not
  for high-frequency, low-latency calls. A small GPU makes it ~10× faster.
- The deterministic agents are unaffected by all of this — they stay instant.
- Keep the model server bound to **localhost** (or a private interface); never
  expose it publicly.

## 4. Configure the API

Set these where the API process reads its environment (systemd unit / compose):

| Var | Meaning |
|---|---|
| `AGENT_LLM_PROVIDER` | `local` (default) or `anthropic` (opt-in, paid) |
| `AGENT_LLM_LOCAL_BASE_URL` | e.g. `http://127.0.0.1:11434/v1` — **presence of this turns the model layer on** |
| `AGENT_LLM_LOCAL_MODEL` | e.g. `qwen2.5:7b-instruct` |
| `AGENT_LLM_LOCAL_API_KEY` | optional; only if your server requires a bearer |
| `AGENT_LLM_LOCAL_TIMEOUT_MS` | optional; default 120000 (CPU inference is slow) |

Check status: `GET /api/v1/agents/llm` →
`{ "configured": true, "provider": "local", "model": "qwen2.5:7b-instruct", … }`.

Try it: `POST /api/v1/agents/specialist/ask { "message": "Any GST gaps this month?" }`
(needs `agents.manage`).

## 5. Verify + roll back

- **Verify:** with the base URL set, `GET /agents/llm` shows `configured: true`;
  an `/ask` run should invoke tools and return an answer (watch it in `/agents/runs`).
- **Roll back / turn off:** unset `AGENT_LLM_LOCAL_BASE_URL` (or stop the model
  server). The model layer reports not-configured and the agents fall back to the
  deterministic paths — no data loss, no downtime.

## 6. Privacy note

Because the model runs on your box, tenant data used for reasoning **never leaves
your server**. This is the main reason to prefer the inbuilt model over any hosted
API for an RMC plant's books.

## 7. If you ever want the hosted option

Set `AGENT_LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY=…`. That path is
metered/paid and sends prompts to Anthropic — it exists only as an explicit
opt-in and is never the default.
