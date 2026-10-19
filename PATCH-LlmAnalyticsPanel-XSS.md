# XSS fix — src/components/features/analytics/LlmAnalyticsPanel.tsx

## Problem (Audit finding H1)
`highlightMentions()` injects raw LLM/analytics response text into
`dangerouslySetInnerHTML` without HTML-escaping or sanitization. Competitor and
brand names (derived from external crawl data) are also interpolated into
`new RegExp()` unescaped. Any `<img src=x onerror=...>`-style payload reaching
the LLM output path executes in an authenticated dashboard session.

## Fix strategy
1. HTML-escape the response text BEFORE wrapping matches in `<span>` markup
   (defense against injected HTML).
2. Escape both the haystack (once) and the regex needles (twice:
   HTML-escape then regex-escape) so matching still works after escaping.
3. Run the final markup through `DOMPurify.sanitize()` as a second safety net
   (keeps the highlight `<span class=...>` elements, strips anything hostile).
4. `gi` flags for case-insensitive matching of brand/competitor names.

## How to apply
1. In `src/components/features/analytics/LlmAnalyticsPanel.tsx`, add the import
   at the top (after the existing imports):

```tsx
import DOMPurify from "dompurify";
```

2. Replace the entire existing `highlightMentions` helper (currently located
   just above the component's `return (...)` statement) with the version below:

```tsx
  // HTML-escape untrusted text before any markup wrapping (audit fix H1)
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // Escape regex metacharacters so external names cannot break the pattern
  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Helper to highlight mentions in response text
  const highlightMentions = (text: string) => {
    if (!text) return "";

    // 1) Escape FIRST so any HTML carried in LLM/external content is inert.
    let highlighted = escapeHtml(text);

    // 2) Highlight brandName in green (needle: HTML-escaped, then regex-escaped)
    const brandNeedle = escapeRegExp(escapeHtml(brandName));
    if (brandNeedle) {
      const brandRegex = new RegExp(`(${brandNeedle})`, "gi");
      highlighted = highlighted.replace(
        brandRegex,
        `<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/10">$1</span>`
      );
    }

    // 3) Highlight competitors in orange/amber
    competitors.forEach((comp) => {
      const compNeedle = escapeRegExp(escapeHtml(comp));
      if (!compNeedle) return;
      const compRegex = new RegExp(`(${compNeedle})`, "gi");
      highlighted = highlighted.replace(
        compRegex,
        `<span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/10">$1</span>`
      );
    });

    // 4) Safety net: sanitize the final markup (keeps span/class, strips scripts)
    return (
      <div
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlighted) }}
        className="leading-relaxed"
      />
    );
  };
```

## Regression test to add
`tests/ui/features/analytics/LlmAnalyticsPanel.test.tsx` — render the panel
with a mocked API response whose text contains `<img src=x onerror=alert(1)>`
and a competitor name containing `.*[` ; assert:
- no `<img>` element in the container,
- the raw text appears HTML-escaped (`&lt;img`),
- highlight spans still render for brand/competitor names.

## Verification gates
- `pnpm test:ui`
- `pnpm typecheck`
- `pnpm lint`
