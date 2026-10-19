#!/usr/bin/env node
/**
 * Oxenn dependency audit gate — remediation kit v1.1
 * Implements the Phase 1 acceptance policy defined in PHASE1-DECISIONS.md
 * (Rulings C and D). Replaces the raw "pnpm audit — zero high" gate.
 *
 * Policy:
 *   FAIL  — any CRITICAL or HIGH advisory that HAS a published fix.
 *   ALLOW — CRITICAL/HIGH advisories with NO published fix, only while listed
 *           in ALLOWLIST below with an unexpired review date (risk acceptance).
 *   WARN  — moderate / low advisories (printed, non-blocking).
 *
 * The script never hides advisory output: every advisory stays visible in
 * every run; the allowlist only controls the exit code. Do NOT use
 * pnpm.auditConfig.ignoreGhsas — that suppresses advisories silently.
 *
 * Usage:
 *   node scripts/audit-gate.mjs                     # runs `pnpm audit --json`
 *   pnpm audit --json | node scripts/audit-gate.mjs --stdin
 *
 * Exit codes: 0 = pass, 1 = policy violation, 2 = could not parse audit output.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Risk-accepted advisories (no upstream fix available).
 * Each entry MUST have: package, reason, expiry (YYYY-MM-DD), exitCriteria.
 * `id` (GHSA) should be filled in from `pnpm audit --json` output; while it is
 * a placeholder, matching falls back to the package name — for UNPATCHED
 * advisories only. Once braces ships a fixed release, that advisory leaves the
 * unpatched path and re-enters the normal FAIL path until the override/lockfile
 * is bumped, so the allowlist cannot mask a real fix.
 */
const ALLOWLIST = [
  {
    id: 'FILL-IN-FROM-AUDIT-JSON', // GHSA id for CVE-2026-93687 (micromatch/braces#73)
    package: 'braces',
    reason:
      'CVE-2026-93687 (HIGH ~8.7) — no patched braces release exists (latest 3.0.3 is the affected version; upstream tracking micromatch/braces#73). Reached only through dev/build tooling (micromatch / chokidar@3 path), not through the Next.js runtime bundle. Formally risk-accepted per Phase 1 Decision Memo, Ruling C.',
    expiry: '2026-11-19', // 30-day review from memo date 2026-10-19
    exitCriteria:
      'Remove this entry and bump the resolution as soon as (a) a patched braces release is published, or (b) the consuming dev-only chain is upgraded off braces (e.g. chokidar@3 -> chokidar@4, which dropped its glob deps).',
  },
];

const SEV_RANK = { critical: 0, high: 1, moderate: 2, low: 3 };
const UNPATCHED = '<0.0.0';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function fetchAuditJson() {
  if (process.argv.includes('--stdin')) return readStdin();
  try {
    return execFileSync('pnpm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // `pnpm audit` exits non-zero when advisories exist; stdout still holds the JSON.
    if (typeof err.stdout === 'string' && err.stdout.trim().startsWith('{')) {
      return err.stdout;
    }
    console.error('audit-gate: could not run `pnpm audit --json`.');
    console.error(String((err && err.stderr) || err.message || err));
    return null;
  }
}

function parseAdvisories(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  // npm-bulk style (used by pnpm): { advisories: { "<ghsa>": {...} } }
  if (data && data.advisories && typeof data.advisories === 'object' && !Array.isArray(data.advisories)) {
    return Object.entries(data.advisories).map(([key, a]) => ({
      id: (a && a.id) || key,
      name: (a && a.module_name) || 'unknown',
      severity: String((a && a.severity) || 'unknown').toLowerCase(),
      patched: typeof (a && a.patched_versions) === 'string' ? a.patched_versions.trim() : '',
      paths: [],
    }));
  }

  // npm v7+ style: { vulnerabilities: { "<name>": { severity, via, fixAvailable } } }
  if (data && data.vulnerabilities && typeof data.vulnerabilities === 'object') {
    const out = [];
    for (const [name, v] of Object.entries(data.vulnerabilities)) {
      const via = Array.isArray(v && v.via) ? v.via : [];
      const sources = via.filter((x) => x && typeof x === 'object');
      if (sources.length === 0) continue; // transitive marker entry only
      for (const src of sources) {
        out.push({
          id: src.id || 'unknown',
          name,
          severity: String(src.severity || v.severity || 'unknown').toLowerCase(),
          patched: v.fixAvailable === false ? UNPATCHED : '',
          fixKnown: v.fixAvailable !== false,
          paths: via.filter((x) => typeof x === 'string').slice(0, 3),
        });
      }
    }
    return out;
  }

  return null;
}

function isUnpatched(a) {
  if (typeof a.fixKnown === 'boolean') return !a.fixKnown;
  return a.patched === UNPATCHED || a.patched === '';
}

function decide(a) {
  const rank = SEV_RANK[a.severity];
  if (rank === undefined) return { action: 'WARN', note: 'unknown severity (non-blocking)' };
  if (rank >= SEV_RANK.moderate) return { action: 'WARN', note: `${a.severity} — recorded, non-blocking` };

  // critical / high
  if (!isUnpatched(a)) return { action: 'FAIL', note: 'fix available — apply via override or upgrade' };

  const entry = ALLOWLIST.find((e) => e.package === a.name || (e.id && e.id === a.id));
  if (!entry) return { action: 'FAIL', note: 'no published fix and not risk-accepted' };
  if (entry.expiry < todayIso()) {
    return { action: 'FAIL', note: `risk acceptance expired ${entry.expiry} — review required (Ruling C/D)` };
  }
  return { action: 'ALLOW', note: `risk-accepted until ${entry.expiry}` };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export async function main() {
  const raw = await fetchAuditJson();
  if (raw == null) process.exit(2);

  const advisories = parseAdvisories(raw);
  if (advisories === null) {
    console.error('audit-gate: unrecognized `pnpm audit --json` shape (expected `advisories` or `vulnerabilities`).');
    process.exit(2);
  }

  const rows = advisories.map((a) => ({ a, d: decide(a) }));
  const rankOf = (r) => (SEV_RANK[r.a.severity] !== undefined ? SEV_RANK[r.a.severity] : 9);
  rows.sort((x, y) => rankOf(x) - rankOf(y) || x.a.name.localeCompare(y.a.name));

  console.log('');
  console.log('Oxenn audit gate v1.1 — FAIL: critical/high with a fix; ALLOW: documented unpatched only; WARN: moderate/low.');
  console.log('');
  console.log(`${pad('SEV', 9)}${pad('PACKAGE', 20)}${pad('ADVISORY', 26)}${pad('FIX', 5)}${pad('DECISION', 9)}NOTE`);
  console.log('-'.repeat(112));
  for (const { a, d } of rows) {
    console.log(
      `${pad(a.severity.toUpperCase(), 9)}${pad(a.name, 20)}${pad(a.id, 26)}${pad(isUnpatched(a) ? 'no' : 'yes', 5)}${pad(d.action, 9)}${d.note}`
    );
  }
  console.log('-'.repeat(112));

  const fails = rows.filter((r) => r.d.action === 'FAIL');
  const allows = rows.filter((r) => r.d.action === 'ALLOW');
  const warns = rows.filter((r) => r.d.action === 'WARN');
  console.log(
    `total: ${rows.length} | fail: ${fails.length} | risk-accepted: ${allows.length} | warn (non-blocking): ${warns.length}`
  );

  for (const entry of ALLOWLIST) {
    if (entry.id.startsWith('FILL-IN')) {
      console.log(`todo: fill the GHSA id for "${entry.package}" (from \`pnpm audit --json\`) into scripts/audit-gate.mjs`);
    }
    const daysLeft = Math.round((new Date(entry.expiry) - new Date(todayIso())) / 86400000);
    console.log(`allowlist: ${entry.package} — review ${entry.expiry} (${daysLeft} day(s) left)`);
  }

  if (fails.length > 0) {
    console.log('');
    console.log('VERDICT: FAIL — resolve the FAIL rows (apply fixes or add a documented, expiring risk acceptance).');
    process.exit(1);
  }
  console.log('');
  console.log('VERDICT: PASS');
  process.exit(0);
}

function isDirectRun() {
  try {
    return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
