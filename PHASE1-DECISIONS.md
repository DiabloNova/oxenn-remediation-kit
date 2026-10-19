# Phase 1 Decision Memo — Authorization & Amended Acceptance Gates

**Kit version:** v1.1 (this memo + updated `package.json` + new `scripts/audit-gate.mjs`)
**Date:** 2026-10-19
**From:** Audit lead (Oxenn evidence-based audit report & remediation plan)
**To:** Phase 1 executor (staging-branch validation run, GitHub Actions run 39200296797)
**Status:** ✅ AUTHORIZED — apply kit v1.1 and re-run the gates per §6

---

## 0. Rulings at a glance

| # | Executor request | Ruling | Details |
|---|---|---|---|
| A | Defer ESLint 10 until its plugin ecosystem supports it cleanly | **APPROVED** — kit reverted to `eslint ^9.39.5`; explicit re-entry criteria + 30-day review | §2 |
| B | Add narrowly scoped overrides for the remaining fixable advisories | **APPROVED** — exact override spec verified against upstream data as of 2026-10-19 | §3 |
| C | Explicitly document or patch the unpatched `braces` advisory | **PATCHING IMPOSSIBLE UPSTREAM** — formal risk acceptance via the audit-gate allowlist, 30-day expiry; structural-removal attempt first | §4 |
| D | Gate clarifications (audit / lint / tests / skipped file) | **AMENDED** — the gates in §5 supersede the report's "0 high" Phase 1 wording | §5 |

Running this on a separate staging branch and refusing to merge with unsatisfied gates was exactly the right call — no reprimand is warranted here. All three blockers trace to upstream facts (plugin peer ranges, an unpatched advisory), not to execution errors. The one genuine correction on our side: **`source-map-js` 1.2.1 is itself vulnerable**, so the resolution floor must move to 1.2.2 (§3.2).

## 1. Where Phase 1 stands

| Gate | Baseline (audit report) | Executor run | v1.1 target |
|---|---|---|---|
| `pnpm audit` | 54 advisories — 3 C / 25 H / 19 M / 7 L | 0 C / 8 H / 4 M | `audit-gate.mjs` PASS (§5) — expected residual: `braces` only |
| typecheck | 0 errors | pass | unchanged |
| unit tests | 164 passed, 1 todo, 1 skipped file | same | no-regression vs baseline (§5) |
| UI tests | 3 passed | 3 passed | unchanged |
| lint | 0 errors / 218 warnings | 0 errors / 220 warnings (ESLint 10) | 0 errors / ≤ 218 warnings (ESLint 9) |
| build + `/api/inngest` route | ok | ok | unchanged |

The drop from 25 high to 8 high confirms the Phase 0→1 override strategy (undici, axios, js-yaml, @grpc/grpc-js, next 16.4.2) worked; the remaining highs are the three packages addressed by Rulings B and C plus any duplicates of them in the resolved tree.

## 2. Ruling A — ESLint 10 deferred (approved)

**Decision:** stay on the latest ESLint 9.x line (`^9.39.5`, already reflected in kit `package.json`) and defer the v10 migration.

**Rationale:**

- `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react` do not yet publish peer ranges that establish clean ESLint 10 support. Forcing it now would require either suppressed peer warnings or a forced override — both contradict the audit's "no suppressed warnings" policy.
- Under ESLint 10 the warning count rose 218 → 220, breaking the lint budget; under ESLint 9 the baseline holds, so deferral also restores the lint gate without any config surgery.
- The EOL exposure from staying on 9.x is **dev-tooling-only** (lint runs pre-merge, never in the runtime attack surface). It is accepted for a 30-day window with a review.

**Re-entry criteria (any one unlocks the v10 migration):**

1. All three plugins publish peer ranges including ESLint 10; or
2. the project migrates `eslint-plugin-import` → the actively maintained `eslint-plugin-import-x` and the remaining plugins declare support; or
3. a 30-day review decides the EOL risk outweighs the migration friction and the team opts for a lint-stack replacement evaluation (e.g., oxlint/biome side-grade — Phase 4 scope).

On adoption, the 218-warning budget **must be re-baselined explicitly in a successor memo** — never silently.

## 3. Ruling B — approved overrides (verified 2026-10-19)

### 3.1 `brace-expansion` — three 2025/2026 advisories, per-major floors

| Advisory (2026) | Class | Fixed in (per major line) |
|---|---|---|
| Uncontrolled recursion in `parseCommaParts` (~7k brace groups / ~125k comma elements → `RangeError`) | HIGH | `1.1.19` / `2.1.5` / `3.0.7` / `5.0.10` |
| Uncontrolled recursion in `expand_` (deep nesting, ~6 KB input → stack exhaustion) | HIGH | `1.1.20` / `2.1.6` / `3.0.8` / `5.0.11` |
| ReDoS — `{a},b}` rewrite quirk (CVE-2026-13149 family, quadratic scan) | MODERATE | `1.1.21` / `2.1.7` / `3.0.9` / `5.0.12` |

CVE-2026-33750 (fixed in `1.1.13` / `2.0.3` / `3.0.2` / `5.0.5`) and GHSA-mh99-v99m-4gvg (backports `1.1.19` / `2.1.5` / `3.0.7`) are covered by the floors below. Note the **4.x line has no patched release** (affected ranges run `>=4.0.0 <5.0.12`), so a 4.x consumer must jump to `^5.0.12`; that selector is expected to be inert (verify with `pnpm why`).

### 3.2 `source-map-js` — GHSA-68fv-2mgg-jv7q / CVE-2026-93749 (HIGH 8.7)

Event-loop DoS via unvalidated per-section offset line in indexed source maps. Affected `>=1.0.0 <1.2.2`; **patched in 1.2.2** (published 2026-10-01). ⚠️ Any earlier pin to 1.2.1 is itself inside the affected range — the floor moves to `^1.2.2`.

### 3.3 Exact override block (kit `package.json`, v1.1)

```json
"overrides": {
  "undici": ">=7.29.1 <8",
  "axios": ">=1.20.0 <2",
  "js-yaml": ">=4.3.2 <5",
  "@grpc/grpc-js": ">=1.14.5 <2",
  "brace-expansion@1": "^1.1.21",
  "brace-expansion@2": "^2.1.7",
  "brace-expansion@3": "^3.0.9",
  "brace-expansion@4": "^5.0.12",
  "source-map-js@<1.2.2": "^1.2.2"
}
```

Per-major selectors are deliberate: a blanket `brace-expansion` override would drag `minimatch@3` (declares `^1.1.7`) across major boundaries and can break CJS consumers. **Verify after install:** every resolved version must satisfy the floors, and `pnpm install` should fail fast if an override creates an impossible combination.

If further fixable highs remain in the audit after this, apply the same policy: narrowly scoped, same-major-where-possible overrides — authorized in advance.

## 4. Ruling C — `braces` (CVE-2026-93687, HIGH ~8.7, no upstream fix)

**Facts:** reported against `braces@3.0.3` — which is still the latest published version; **no fixed release exists** and npm publishes nothing to upgrade to. Upstream tracking: `micromatch/braces#73` (opened 2026-09-23). A version-based override is therefore impossible — there is nothing to jump to.

**Exposure analysis:** `braces` reaches the tree through `micromatch` / `chokidar@3` / `fast-glob` — build and dev tooling, not the Next.js runtime bundle. Exploitation of this DoS class requires attacker-controlled glob-pattern input reaching build tooling, which the web-facing surface does not provide. Record the actual `pnpm why braces` output in the run evidence to substantiate this.

**Step 1 — structural removal attempt (time-boxed ~30 min):**

- `pnpm why braces` → identify the consuming chain.
- If the path goes through `chokidar@3`: chokidar v4 dropped glob support and its `micromatch`/`braces` dependencies (13 deps → 1). If that consumer is dev-only, schedule the major bump for Phase 4 — do not rush a watcher major-bump into Phase 1.
- If the path is `micromatch@4` with no removable consumer: proceed to Step 2.

**Step 2 — formal risk acceptance (shipped in kit v1.1):** `scripts/audit-gate.mjs` carries an allowlist entry for `braces` with reason, **expiry 2026-11-19**, and exit criteria (patched release published, or the consuming chain upgraded off `braces`). The advisory remains visible in every audit run — the script controls only the exit code.

**Prohibited:** `pnpm.auditConfig.ignoreGhsas` (silent suppression) and any fake "fix" override. Both would hide the advisory without documentation; the allowlist achieves the opposite — documented, expiring, and reviewed.

## 5. Ruling D — amended acceptance gates (supersede the report's Phase 1 wording)

| Gate | v1.1 definition |
|---|---|
| Audit | `node scripts/audit-gate.mjs` exits 0: **0 critical; 0 high with a published fix**; unpatched highs allowed only via the allowlist (documented, unexpired); moderate/low are recorded warnings, non-blocking |
| Lint | ESLint 9: 0 errors, warnings ≤ 218 (pre-existing baseline; the 220 figure came from the ESLint 10 experiment and is moot after Ruling A) |
| Unit tests | No regression vs recorded baseline: **164 passed, 1 todo, 1 skipped file** (pre-existing at baseline, therefore acceptable) — file a backlog ticket to unskip the skipped file and record its name in the evidence |
| UI tests | 3 passed |
| Typecheck / build / route | unchanged — `tsc --noEmit` clean; production build succeeds; `/api/inngest` present in build manifest |
| Drizzle | unchanged — `drizzle-kit check`, `verify-rls-migrations`, tenant-tables check; migrate chain + isolation suite on a disposable DB |

"No skipped test files" moves to the backlog as an aspiration — it was already false at the audited baseline, so it cannot be a Phase 1 regression gate.

## 6. Re-run checklist

```bash
git checkout main && git pull
git checkout -b fix/audit-remediation-p1-v1.1     # clean staging branch
# apply kit v1.1 (all files per README-FIXES.md table, incl. updated package.json)
# copy scripts/audit-gate.mjs into the repo's scripts/ directory
pnpm install                                       # lockfile update; new overrides engage
pnpm why brace-expansion                           # all resolved >= 1.1.21 / 2.1.7 / 3.0.9 / 5.0.12
pnpm why source-map-js                             # all resolved >= 1.2.2
pnpm why braces                                    # capture chain for the risk-acceptance record
pnpm typecheck
pnpm lint                                          # 0 errors; capture warning count (<= 218)
pnpm test:unit && pnpm test:ui
pnpm build
node scripts/audit-gate.mjs                        # must PASS (exit 0)
npx drizzle-kit check && pnpm db:verify-rls-migrations
```

Evidence to attach to the run: lockfile diff, raw `pnpm audit --json` output, gate output, lint warning count, test summaries, `pnpm why braces` output.

## 7. Sign-off

Phase 1 closes when: audit-gate **PASS** + lint **≤ 218 warnings / 0 errors** + tests **no-regression** + build **ok** + evidence artifact linked. Only then merge the staging branch into `fix/audit-remediation`.

Phase 4 backlog gains two standing review items: (i) **ESLint 10 re-entry** — 30-day review per Ruling A; (ii) **`braces` unpatched advisory** — 30-day review per Ruling C (removal trigger: patched release or `chokidar@4` path).

This memo amends the execution plan's Phase 1 acceptance criteria; the PDF/DOCX report remains the narrative baseline and needs no regeneration.
