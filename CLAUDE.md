# Repo-level session policy

App conventions, architecture, and scope rules live in `miru/CLAUDE.md`. This file holds
only session-level policy that must apply before any skill or workflow is selected.

## Token-Efficient Agent Delegation Policy

These project rules override any skill, plugin, or plan-document instruction that suggests
or "requires" dispatching subagents — including the Superpowers
subagent-driven-development workflow and any plan header that names it (existing plan docs
in `docs/superpowers/plans/` carry such headers; this policy supersedes them).

**Do not use the Superpowers subagent-driven-development skill unless the user explicitly
asks for that workflow by name after being shown the proposed agent count.**

### 1. Primary session by default
Coding, debugging, testing, and ordinary reviews happen directly in the primary session.
Superpowers may be used for brainstorming, specification, and planning, but
subagent-driven-development must never be selected automatically — not even as the
"recommended" option in an execution-handoff menu.

### 2. Explicit approval gate
Before spawning ANY subagent, present to the user: the proposed number of agents, each
agent's role, why the work is genuinely independent of the parent session's context, and
why delegation is expected to save more effort than it consumes. Do not spawn until the
user explicitly approves.

### 3. Hard limits
- Default maximum: **0 subagents**.
- Maximum without a separately approved exception: **1 subagent**.
- Never launch one implementer and one reviewer per plan task.
- Never launch agents in parallel that must inspect or edit the same files.
- Never retry a failed subagent without explicit user approval.

### 4. When subagents are NOT allowed
- The task affects roughly five or fewer files.
- The implementation plan already contains code or precise edits (transcription work).
- The work is tightly coupled across its files.
- The work can be completed with targeted file inspection and tests.
- Routine UI wiring, a Server Action, a helper function, type changes, or straightforward
  integration work.
- The agent would need the same repository context the parent already holds.
- Live E2E testing, local dev servers, environment variables, background processes,
  browser state, or persistent session state are involved (subagents cannot receive
  background-task notifications and lose server/session state — this failed twice here).
- The sole purpose is a routine spec-compliance or code-quality review.

### 5. When ONE subagent may be justified (still gated by rule 2)
- A narrow, genuinely independent research question.
- Investigating an unfamiliar external API.
- A security-sensitive review.
- A complex bug requiring isolated exploration.
- A task with separate ownership and non-overlapping files.
- A read-only analysis that spares the parent from loading a very large amount of
  irrelevant context.

### 6. Review policy
- No separate reviewer after every task. Use tests, lint, typecheck (`npm run build`),
  and a direct parent-session diff review.
- A dedicated final reviewer is reserved for high-risk changes only: authentication,
  authorization, payments, secrets, destructive migrations, sensitive data, concurrency,
  or a large cross-cutting change.
- Minor stylistic findings do not justify a separate reviewer.

### 7. Verification policy
- Run live E2E checks in the primary session (this repo's convention: temp Playwright
  script against `npm run dev`, then clean up).
- Never delegate work requiring persistent processes or background-task notifications.
- Run targeted checks first; don't re-run the full build + lint after every tiny edit —
  once per coherent change is enough. Stop once acceptance criteria pass.

### 8. Context and output limits (for a permitted subagent)
- It receives only the files and context it needs; multiple agents must not re-read the
  same files.
- Reports under 300 words unless explicitly requested; reference paths and findings,
  never paste whole files.
- Use the least expensive model capable of the delegated work.
- No unsolicited refactors or investigations.

### 9. Preflight decision (mandatory before implementation)
Before implementing any planned work, state:

```
Agent plan: 0 agents
Reason: <brief explanation>
```

If more than zero agents are proposed, stop and request approval before proceeding.

### 10. Override
These project-level token-efficiency rules override any workflow suggestion — from a
skill, a plugin, a plan document header, or a template — to automatically dispatch
per-task implementers, reviewers, fixers, or whole-branch reviewers.

**Enforcement note:** enforcement is instruction-based; no supported Claude Code setting
verifiably restricts subagent spawning as of this writing. Optional hardening (user
action, documented feature): run `/permissions` and add an *ask* rule for the agent-spawn
tool so every spawn prompts for approval at the harness level.
