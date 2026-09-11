/**
 * AI crawlers we recognize in robots.txt.
 *
 * IMPORTANT: this list is INFORMATIONAL only ; it is no longer a scoring signal.
 * Per Google's AI Optimization Guide, AI Overviews and AI Mode retrieve from the
 * regular Google Search index. Blocking or allowing third-party crawlers like
 * GPTBot or ClaudeBot is a separate decision (about training data and third-party
 * AI products) and has no effect on Google AI citation eligibility.
 *
 * We still surface what we find so site owners can make an informed choice,
 * but it does not impact the score.
 *
 * Source: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Google-Extended",
  "Gemini-Deep-Research",
  "PerplexityBot",
  "Applebot-Extended",
  "Amazonbot",
  "Bingbot",
  "DuckAssistBot",
  "YouBot",
  "meta-externalagent",
  "PhindBot",
  "cohere-ai",
  "ExaBot",
] as const;

/**
 * Engine version. Bumped any time the scoring methodology changes materially.
 * Surfaced in the report UI so users (and we) can tell which methodology a
 * historical scan used.
 */
export const ENGINE_VERSION = "2.5.0-astra-accuracy";

/**
 * Dimension weights ; Phase 3, final target (May 2026).
 *
 * Rebuilt against Google Search Essentials and the Google AI Optimization Guide.
 * Per Google's own guidance:
 *   - `llms.txt` is NOT required for AI search visibility.
 *   - The third-party AI crawler allow-list is NOT a Google signal.
 *   - JSON-LD structured data is NOT required for AI Overviews.
 *   - What matters is the same SEO foundation Google has always emphasized:
 *     indexability, helpful content, semantic HTML, server-rendered main content,
 *     page experience, real internal linking, and original substance.
 *
 * Eleven scored dimensions with project-defined weights and thresholds.
 * Source links provide background guidance, not official Google or Microsoft
 * weights, certification, or a measurement of citation probability.
 *
 * Source: https://developers.google.com/search/docs/essentials
 */
export const DIMENSION_WEIGHTS = {
  aeo: 0.15,             // Content structure & helpfulness ; AI Mandate 1 + Pillar C
  indexability: 0.15,    // HTTP 200, noindex, canonical hygiene ; Pillar A
  semantic: 0.10,        // Semantic HTML ; AI Mandate 2 + Pillar C
  rendering: 0.10,       // Server-rendered main content ; AI Mandate 2
  pageExperience: 0.10,  // HTTPS + viewport + payload heuristics ; Pillar C
  meta: 0.10,            // Title, description, canonical, OG ; Pillar A + C
  schema: 0.07,          // Structured data ; helpful for rich results, not required for AI
  robots: 0.08,          // robots.txt presence + sitemap directive + Googlebot access
  sitemap: 0.05,         // sitemap.xml discoverability ; Pillar C
  internalLinking: 0.05, // Real <a href>, depth from home ; Pillar C (NEW Phase 3)
  helpfulContent: 0.05,  // Thin content / dup titles / E-E-A-T proxy ; Pillar B (NEW Phase 3)
} as const;

/**
 * Informational-only dimensions. These run during the audit and their findings
 * are shown to the user, but they DO NOT contribute to the overall score.
 *
 * Why: Google explicitly says these are not required for AI search visibility.
 * Scoring users down for skipping them would be punishing them for ignoring
 * vendor folklore Google itself has rejected.
 */
export const INFORMATIONAL_DIMENSIONS = new Set([
  "aiSurfaceCoverage",
  "indexNow",
  "llmsTxt",
  "aiCrawlers",
]);

export const DIMENSION_INFO = [
  {
    id: "aeo",
    name: "Content Structure & Helpfulness",
    description:
      "Patterns in paragraphs, headings, lists, and direct answers; not a measurement of semantic helpfulness",
    weight: 0.15,
    fixable: false,
  },
  {
    id: "indexability",
    name: "Indexability & Crawl Eligibility",
    description:
      "HTTP 200, no accidental noindex, clean canonical ; Pillar A of Google Search Essentials",
    weight: 0.15,
    fixable: true,
  },
  {
    id: "semantic",
    name: "Semantic HTML",
    description:
      "Real <h1>, <main>, <nav>, <article> tags ; Google emphasizes this for AI and accessibility",
    weight: 0.10,
    fixable: false,
  },
  {
    id: "rendering",
    name: "Server-Rendered Content",
    description:
      "Main content visible in the raw HTML response (not painted by JavaScript after load)",
    weight: 0.10,
    fixable: false,
  },
  {
    id: "pageExperience",
    name: "Page Experience",
    description:
      "HTTPS, mobile viewport, payload size, render-blocking scripts ; static HTML checks, not measured Core Web Vitals",
    weight: 0.10,
    fixable: false,
  },
  {
    id: "meta",
    name: "Meta & Canonical",
    description:
      "Title, description, canonical, and Open Graph tags on every page",
    weight: 0.10,
    fixable: true,
  },
  {
    id: "robots",
    name: "robots.txt",
    description: "File exists, allows Googlebot, and references the sitemap",
    weight: 0.08,
    fixable: true,
  },
  {
    id: "schema",
    name: "Schema.org JSON-LD",
    description:
      "Structured data where the page genuinely fits a schema type. Helpful for rich results ; not required for AI Overviews",
    weight: 0.07,
    fixable: true,
  },
  {
    id: "sitemap",
    name: "sitemap.xml",
    description: "Sitemap structure, sampled URL coverage and robots reference; not full protocol validation",
    weight: 0.05,
    fixable: true,
  },
  {
    id: "internalLinking",
    name: "Internal Linking & Site Architecture",
    description:
      "Internal links and reachability within the crawl sample; not a full-site orphan-page check",
    weight: 0.05,
    fixable: true,
  },
  {
    id: "helpfulContent",
    name: "Helpful Content & Spam Self-Check",
    description:
      "Substantive content, no thin pages, no duplicate titles, author signals ; Pillar B + AI Mandate 1",
    weight: 0.05,
    fixable: false,
  },
] as const;

/**
 * Informational dimension metadata ; surfaced in the report under an
 * "Informational (not scored)" section with methodology notes.
 */
export const INFORMATIONAL_DIMENSION_INFO = [
  {
    id: "llmsTxt",
    name: "llms.txt",
    description:
      "Optional machine-readable text files are observed for completeness; their presence is not scored.",
    googleQuote:
      "You don't need to create new machine readable files, AI text files, markup, or Markdown to appear in generative AI search.",
    googleSource:
      "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
  },
  {
    id: "aiCrawlers",
    name: "Third-Party AI Crawler Allow-List",
    description:
      "Whether your robots.txt allows GPTBot, ClaudeBot, PerplexityBot, etc. This affects training-data access for third-party AI products. It does NOT affect Google AI Overviews citation eligibility, which uses the regular Google index.",
    googleQuote:
      "Our generative AI features on Google Search are rooted in our core Search ranking and quality systems.",
    googleSource:
      "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
  },
] as const;

export const GRADE_THRESHOLDS = [
  { min: 90, grade: "A", label: "Excellent" },
  { min: 80, grade: "B", label: "Good" },
  { min: 70, grade: "C", label: "Average" },
  { min: 60, grade: "D", label: "Below Average" },
  { min: 0, grade: "F", label: "Poor" },
] as const;

/** Per-page dimension ids: these populate `pages` in deep audits. */
export const PER_PAGE_DIMENSIONS = [
  "schema",
  "aeo",
  "meta",
  "semantic",
  "rendering",
  "indexability",
  "pageExperience",
  "internalLinking",
  "helpfulContent",
] as const;

export const MAX_PAGES_TO_DISCOVER = 25;
export const QUICK_PAGES_TO_DISCOVER = 10;

/** In-memory rate limit (consumed by src/lib/audit/rate-limit.ts). */
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Grade helper used by every check and the scorer. */
export function gradeFromScore(score: number): string {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade;
  }
  return "F";
}
