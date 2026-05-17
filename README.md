# dhit-audit-lib

Shared AI-search audit engine for DarkHorse IT properties. Consumed by:

- **llmsearch-yourupdatedpage** — paid deep-audit product at `llmsearch.yourupdatedpage.xyz`
- **yourupdatedpage** — free lite scanner at `yourupdatedpage.xyz/tools/llm-check`

Both consumers add this repo as a **git submodule** at `src/lib/audit/`. Existing imports
like `@/lib/audit/scorer` continue to work because the path resolution doesn't change —
the folder is just sourced from this repo instead of being checked in directly.

## What it scores

11 dimensions, weights sum to 1.00. Every dimension maps to a citable line in
Google's or Microsoft's own published guidance.

| Dimension | Weight | Source |
|---|---|---|
| Content Structure & Helpfulness | 15% | Google AI Optimization Guide, Mandate 1 |
| Indexability & Crawl Eligibility | 15% | Google Search Essentials, Pillar A |
| Semantic HTML | 10% | Google AI Mandate 2 + Pillar C |
| Server-Rendered Content | 10% | Google AI Mandate 2 |
| Page Experience | 10% | Google CWV / Bing Webmaster Guidelines |
| Meta & Canonical | 10% | Google Pillar A + C |
| robots.txt | 8% | Google + Bing Webmaster Guidelines |
| Schema.org JSON-LD | 7% | helpful for rich results — **not required** for AI |
| sitemap.xml | 5% | Google + Bing |
| Internal Linking & Site Architecture | 5% | Google Pillar C |
| Helpful Content & Spam Self-Check | 5% | Google Pillar B + AI Mandate 1 |

Plus 4 **informational** dimensions that don't affect the score:

- AI Surface Coverage — per-AI-product eligibility map (Google AI Overviews, Copilot, ChatGPT search, Perplexity, Brave, DuckDuckGo, You.com)
- IndexNow Adoption — Microsoft protocol detection
- llms.txt — Google says not required, surfaced for transparency
- Third-Party AI Crawler Allow-List — not a Google AI signal, surfaced for transparency

## Engine versions

| Version | Notes |
|---|---|
| `2.0.0-google-aligned` | Initial Google-aligned rebuild (Phase 1) |
| `2.1.0-google-aligned` | Added indexability + page-experience (Phase 2) |
| `2.2.0-google-aligned` | Added internal-linking + helpful-content + final weights (Phase 3) |
| `2.3.0-google-microsoft-aligned` | Microsoft AI Performance Dashboard alignment (Phase 4-MS) |
| `2.4.0-google-microsoft-aligned-psi` | Real CWV via PageSpeed Insights API (Phase 4-G) |

## Public API

```ts
import { runLiteAudit, runDeepAudit, crawlSite } from "@/lib/audit";

// Free lite scanner — fast, no PSI, no email security DNS.
const crawl = await crawlSite("https://example.com");
const result = runLiteAudit(crawl); // returns AuditResult

// Paid deep audit — adds PSI Core Web Vitals + email security.
// Requires PSI_API_KEY env var for real CWV; falls back to static heuristic otherwise.
const deep = await runDeepAudit(crawl);
```

## Adding as a submodule

In the consuming app:

```bash
# First time
git submodule add https://github.com/yubajefffries/dhit-audit-lib.git src/lib/audit
git commit -am "feat: consume shared dhit-audit-lib via submodule"

# Updating after a lib change
git submodule update --remote src/lib/audit
git commit -am "chore(audit-lib): bump to <new-sha>"
```

## Local development

This lib is TypeScript-only, consumed as source. No build step. Type-check with the consumer app's tsc.

```bash
npm install   # only installs the peer dep cheerio at the lib root, optional
npx tsc --noEmit
```

## Sources

- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [Google AI Optimization Guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)
- [Microsoft AI Performance Dashboard (Mar 2026)](https://about.ads.microsoft.com/en/blog/post/march-2026/the-ai-performance-dashboard-your-view-into-where-your-brand-appears-across-the-ai-web)
- [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started)
- [IndexNow protocol](https://www.indexnow.org/)
