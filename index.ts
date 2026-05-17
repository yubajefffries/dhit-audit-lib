/**
 * dhit-audit-lib — shared AI-search audit engine.
 *
 * Consumed by:
 *   - llmsearch-yourupdatedpage (the paid deep-audit product at llmsearch.yourupdatedpage.xyz)
 *   - yourupdatedpage (the free lite scanner at yourupdatedpage.xyz/tools/llm-check)
 *
 * Both consumers add this repo as a git submodule at src/lib/audit/. Imports
 * like `@/lib/audit/scorer` resolve to this lib's files unchanged.
 *
 * Engine version: see ENGINE_VERSION in constants.ts.
 *
 * Sources every dimension maps to:
 *   - Google Search Essentials — https://developers.google.com/search/docs/essentials
 *   - Google AI Optimization Guide — https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
 *   - Bing Webmaster Guidelines — https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a
 *   - Microsoft AI Performance Dashboard — https://about.ads.microsoft.com/en/blog/post/march-2026/the-ai-performance-dashboard-your-view-into-where-your-brand-appears-across-the-ai-web
 */

export {
  runLiteAudit,
  runDeepAudit,
} from "./scorer";

export {
  AI_CRAWLERS,
  DIMENSION_WEIGHTS,
  DIMENSION_INFO,
  INFORMATIONAL_DIMENSIONS,
  INFORMATIONAL_DIMENSION_INFO,
  GRADE_THRESHOLDS,
  PER_PAGE_DIMENSIONS,
  ENGINE_VERSION,
  MAX_PAGES_TO_DISCOVER,
  QUICK_PAGES_TO_DISCOVER,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  gradeFromScore,
} from "./constants";

export type {
  AuditResult,
  CrawlResult,
  DimensionResult,
  EmailSecurityResult,
  Finding,
  PageAuditSummary,
  PageData,
  PerPageScore,
  DkimResult,
  DmarcResult,
  SpfResult,
} from "./types";

export { crawlSite } from "./crawler";
export { parseHTML, extractPageInfo, detectSiteType } from "./parsers";
export { checkRateLimit } from "./rate-limit";

// Direct check exports (consumers usually go through runLiteAudit/runDeepAudit,
// but these are public for advanced uses like the smoke scripts).
export { checkSchema } from "./checks/schema";
export { checkRobots, checkAiCrawlers } from "./checks/robots";
export { checkLlmsTxt } from "./checks/llms-txt";
export { checkAeoContent } from "./checks/aeo";
export { checkMetaTags } from "./checks/meta-tags";
export { checkSitemap } from "./checks/sitemap";
export { checkSemantic } from "./checks/semantic";
export { checkRendering } from "./checks/rendering";
export { checkIndexability } from "./checks/indexability";
export {
  checkPageExperience,
  applyPsiToPageExperience,
} from "./checks/page-experience";
export { checkInternalLinking } from "./checks/internal-linking";
export { checkHelpfulContent } from "./checks/helpful-content";
export { checkAiSurfaceCoverage } from "./checks/ai-surface-coverage";
export { checkIndexNow } from "./checks/indexnow";
export { checkEmailSecurity } from "./checks/email-security";
export { fetchPsi } from "./checks/psi";
export type { PsiResult, CwvMetric } from "./checks/psi";
