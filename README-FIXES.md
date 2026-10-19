# Oxenn Remediation Kit — Apply Guide

Source audit: **Oxenn Evidence-Based Audit Report** (same delivery folder).
Every change here maps to a finding ID (C1, H1, M1-M8, L1-L2) from that report.

## Contents of this folder

| File / path | Action | Finding |
|---|---|---|
| `package.json` | REPLACE root `package.json` | C1, H2-H5, M1-M5 |
| `next.config.ts` | REPLACE root `next.config.ts` | M8 |
| `tsconfig.json` | REPLACE root `tsconfig.json` | L4 |
| `components.json` | REPLACE root `components.json` | M7 |
| `.env.example` | REPLACE root `.env.example` | M6 |
| `src/lib/utils.ts` | CREATE (new file) | M7 |
| `database/drizzle/0004_abandoned_black_crow.sql` | REPLACE (adds trailing newline only — content identical) | L2 |
| `PATCH-LlmAnalyticsPanel-XSS.md` | Follow instructions (code patch) | H1 |
| `PHASE1-DECISIONS.md` | Read before executing Phase 1 (authorization + amended gates) | Phase 1 |
| `scripts/audit-gate.mjs` | COPY to repo `scripts/`, replaces raw `pnpm audit` gate | Phase 1 |

## Deletion list (run from repo root)

```bash
# L1 — repo hygiene: junk/stale files
git rm --cached database/schema/index.ts.tmp2 && rm database/schema/index.ts.tmp2
git rm --cached test_db.ts && rm test_db.ts
git rm --cached update_tenant.js && rm update_tenant.js
git rm --cached verification/phase-0/npm-build.log verification/phase-0/npm-lint.log verification/phase-0/npm-tsc.log verification/phase-0/pnpm-build.log verification/phase-0/pnpm-lint.log verification/phase-0/pnpm-tsc.log verification/phase-0/replay-stock-failure.log
rm -f verification/phase-0/*.log

# M7 — relocate the single live root component, then remove orphans
git mv components/navigation/FloatingSidebar.tsx src/components/navigation/FloatingSidebar.tsx
# then in src/app/[locale]/layout.tsx change:
#   import FloatingSidebar from "../../../components/navigation/FloatingSidebar";
# to:
#   import FloatingSidebar from "@/components/navigation/FloatingSidebar";
git rm -r --cached components lib && rm -rf components lib
# NOTE: verify with `rg "components/live-analytics|components/ui/button|lib/utils" src/`
# that nothing else references the root trees before deleting (audit found none alive
# except FloatingSidebar). Keep a backup branch: git checkout -b backup/root-cleanup
```

## Application order (do not reorder)

1. **Snapshot first**: `git checkout -b fix/audit-remediation` on a clean tree.
2. Replace/create all files from this folder (table above).
3. Run the deletion list (both blocks).
4. `pnpm install` — expect lockfile update (next 16.4.2, overrides engage).
   - If peer conflicts appear for `axios`/`undici` overrides, loosen that one
     override to `^1.20.0` / `^7.29.1` and re-run.
5. Apply the XSS patch (`PATCH-LlmAnalyticsPanel-XSS.md`).
6. Verification gates, in order:
   ```bash
   pnpm typecheck
   pnpm lint            # expect <= the pre-change warning count (218)
   pnpm test:unit && pnpm test:ui
   pnpm build           # with DATABASE_URL + SESSION_SECRET set
   node scripts/audit-gate.mjs   # v1.1 gate: 0 critical, 0 fixable-high (PHASE1-DECISIONS.md §5)
   npx drizzle-kit check
   pnpm db:verify-rls-migrations
   pnpm tsx scripts/database/verify-tenant-tables.ts
   ```
7. Smoke-test in a disposable database (guardrails: `DISPOSABLE_DB=true`,
   `ALLOW_DB_PUSH=true` only on an empty local db):
   ```bash
   pnpm db:migrate      # full chain 0000-0012 must apply cleanly
   pnpm test:isolation  # tenant isolation suite against migrated db
   ```

## Rollback

Single commit on `fix/audit-remediation` → `git revert` or delete branch.
No migration/schema changes are included in this kit, so no database rollback
is required. The only DB-related file is a whitespace-only fix (0004 newline).

## Known follow-ups intentionally NOT in this kit

- `eslint` is pinned to `^9.39.5` in v1.1: ESLint 10 is **deferred** until
  `eslint-plugin-import`, `eslint-plugin-jsx-a11y` and `eslint-plugin-react`
  declare clean support (or the project migrates to `eslint-plugin-import-x`).
  30-day review; on adoption, re-baseline the 218-warning budget explicitly (H5, PHASE1-DECISIONS.md §2).
- `react 19.3.1`, `framer-motion 14`, `@vercel/analytics 2`, `typescript 7`
  are major/minor upgrades deferred to a separate change window (report §9.3).
- `drizzle-kit 1.x` migration (removes deprecated @esbuild-kit chain, M3) —
  schedule with a fresh `drizzle-kit generate --dry` diff review.

## v1.1 addendum (2026-10-19) — Phase 1 decision memo

Two files added to this kit:

- `PHASE1-DECISIONS.md` — authorization rulings A–D for the Phase 1 execution run
  and the amended acceptance gates that supersede the report's "0 high" wording.
- `scripts/audit-gate.mjs` — policy-based audit gate (copy to repo `scripts/`):
  fails on critical/high advisories WITH a published fix, risk-accepts documented
  unpatched advisories with a 30-day expiry, warns on moderate/low.

`package.json` changes in v1.1:

- `eslint` reverted `^10.13.0` → `^9.39.5` (Ruling A: ESLint 10 deferred).
- Overrides added (Ruling B): `brace-expansion` per-major floors
  `1→^1.1.21`, `2→^2.1.7`, `3→^3.0.9`, `4→^5.0.12` (the 4.x line has no patch);
  `source-map-js@<1.2.2` → `^1.2.2` — note that 1.2.1 is itself affected by
  GHSA-68fv-2mgg-jv7q / CVE-2026-93749, so any earlier 1.2.1 pin must be replaced.
- `braces` (CVE-2026-93687) has no upstream patch: risk-accepted in the audit-gate
  allowlist with a 2026-11-19 review date (Ruling C). Do NOT add
  `pnpm.auditConfig.ignoreGhsas` — that would suppress the advisory silently.
