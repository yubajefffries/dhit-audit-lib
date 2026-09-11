import type {
  AuditResult,
  CrawlResult,
  DimensionResult,
  Finding,
  PageAuditSummary,
  PerPageScore,
} from "./types";
import {
  DIMENSION_WEIGHTS,
  ENGINE_VERSION,
  PER_PAGE_DIMENSIONS,
  gradeFromScore,
} from "./constants";
import { checkSchema } from "./checks/schema";
import { checkRobots, checkAiCrawlers } from "./checks/robots";
import { checkLlmsTxt } from "./checks/llms-txt";
import { checkAeoContent } from "./checks/aeo";
import { checkMetaTags } from "./checks/meta-tags";
import { checkSitemap } from "./checks/sitemap";
import { checkSemantic } from "./checks/semantic";
import { checkRendering } from "./checks/rendering";
import { checkIndexability } from "./checks/indexability";
import { checkPageExperience } from "./checks/page-experience";
import { checkInternalLinking } from "./checks/internal-linking";
import { checkHelpfulContent } from "./checks/helpful-content";
import { checkAiSurfaceCoverage } from "./checks/ai-surface-coverage";
import { checkIndexNow } from "./checks/indexnow";
import { applyPsiToPageExperience } from "./checks/page-experience";
import { fetchPsi } from "./checks/psi";
import { checkEmailSecurity } from "./checks/email-security";

function generatePriorities(dimensions: DimensionResult[]): string[] {
  return dimensions
    .filter((d) => !d.informational && d.score < 100)
    .map((d) => ({
      id: d.id,
      name: d.name,
      impact: (100 - d.score) * d.weight,
      score: d.score,
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map(
      (d) =>
        `${d.name}: ${d.score}/100, ${d.score < 50 ? "needs significant improvement" : "room for improvement"}`,
    );
}

/**
 * Runs all dimension checks against a crawl. Returns a flat array containing
 * both scored and informational dimensions. The caller is responsible for
 * splitting them via the `informational` flag.
 */
function runAllChecks(crawl: CrawlResult): DimensionResult[] {
  return [
    // Scored dimensions
    checkAeoContent(crawl.pages),
    checkIndexability(crawl.pages),
    checkSemantic(crawl.pages),
    checkRendering(crawl.pages),
    checkPageExperience(crawl.pages),
    checkMetaTags(crawl.pages),
    checkRobots(crawl.robotsTxt, crawl.pages.map((p) => new URL(p.url).pathname + new URL(p.url).search)),
    checkSchema(crawl.pages),
    checkSitemap(crawl.sitemapXml, crawl.robotsTxt, crawl.pages),
    checkInternalLinking(crawl.pages, crawl.baseUrl),
    checkHelpfulContent(crawl.pages),
    // Informational only (no score impact)
    checkAiSurfaceCoverage(crawl.robotsTxt),
    checkIndexNow(crawl.robotsTxt, crawl.pages),
    checkLlmsTxt(crawl.llmsTxt, crawl.llmsFullTxt),
    checkAiCrawlers(crawl.robotsTxt),
  ];
}

function computeOverallScore(dimensions: DimensionResult[]): number {
  return Math.round(
    dimensions
      .filter((d) => !d.informational)
      .reduce((sum, d) => {
        const weight =
          DIMENSION_WEIGHTS[d.id as keyof typeof DIMENSION_WEIGHTS] ?? d.weight;
        return sum + d.score * weight;
      }, 0),
  );
}

/**
 * Combines per-page dimension scores into a per-page overall score.
 * Site-level dimensions contribute their aggregate score to every page
 * equally, which is correct: a broken robots.txt hurts every page.
 *
 * Informational dimensions are skipped — they don't contribute to per-page
 * scores either.
 */
function composePageScores(
  pages: CrawlResult["pages"],
  dimensions: DimensionResult[],
): PageAuditSummary[] {
  const scored = dimensions.filter((d) => !d.informational);

  const perPageDimensionScores: Record<string, Map<string, number>> = {};
  for (const dim of scored) {
    if (!PER_PAGE_DIMENSIONS.includes(dim.id as typeof PER_PAGE_DIMENSIONS[number])) continue;
    if (!dim.pages) continue;
    const map = new Map<string, number>();
    for (const p of dim.pages as PerPageScore[]) {
      map.set(p.url, p.score);
    }
    perPageDimensionScores[dim.id] = map;
  }

  return pages.map((page) => {
    let score = 0;
    for (const dim of scored) {
      const weight =
        DIMENSION_WEIGHTS[dim.id as keyof typeof DIMENSION_WEIGHTS] ?? dim.weight;
      const perPage = perPageDimensionScores[dim.id];
      const value = perPage?.get(page.url) ?? dim.score;
      score += value * weight;
    }
    const rounded = Math.round(score);
    return {
      url: page.url,
      path: page.path,
      title: page.title,
      overallScore: rounded,
      grade: gradeFromScore(rounded),
    };
  });
}

function stripPerPage(dimensions: DimensionResult[]): DimensionResult[] {
  return dimensions.map((d) => {
    if (!d.pages) return d;
    // Lite omits page grouping, but must retain the diagnostic evidence.
    const findings = [...d.findings];
    const key = (f: Finding) => JSON.stringify([f.type, f.message, f.detail ?? "", f.page ?? ""]);
    const seen = new Set(findings.map(key));
    for (const page of d.pages) {
      for (const finding of page.findings) {
        const evidence = { ...finding, page: finding.page ?? page.url };
        if (!seen.has(key(evidence))) {
          findings.push(evidence);
          seen.add(key(evidence));
        }
      }
    }
    const copy: DimensionResult = { ...d, findings };
    delete copy.pages;
    return copy;
  });
}

function splitDimensions(all: DimensionResult[]): {
  scored: DimensionResult[];
  informational: DimensionResult[];
} {
  return {
    scored: all.filter((d) => !d.informational),
    informational: all.filter((d) => d.informational),
  };
}

export function runLiteAudit(crawl: CrawlResult): AuditResult {
  const all = runAllChecks(crawl);
  const overallScore = computeOverallScore(all);
  const { scored, informational } = splitDimensions(stripPerPage(all));
  return {
    url: crawl.baseUrl,
    timestamp: new Date().toISOString(),
    siteType: crawl.siteType,
    pagesAudited: crawl.pages.length,
    overallScore,
    grade: gradeFromScore(overallScore),
    dimensions: scored,
    informational,
    engineVersion: ENGINE_VERSION,
    priorities: generatePriorities(all),
  };
}

export async function runDeepAudit(crawl: CrawlResult): Promise<AuditResult> {
  const all = runAllChecks(crawl);

  const domain = new URL(crawl.baseUrl).hostname.replace(/^www\./, "");

  // Fetch PSI for the homepage in parallel with email security DNS lookups.
  // PSI typically takes 20-40s; email security typically <5s. They run
  // concurrently so the deep audit only pays the longer of the two.
  const [emailSecurity, psi] = await Promise.all([
    checkEmailSecurity(domain).catch(() => undefined),
    fetchPsi(crawl.baseUrl).catch(() => null),
  ]);

  // Merge PSI into the pageExperience dimension (replaces static score with
  // real Lighthouse / CrUX data). If PSI failed or wasn't available, the
  // static heuristic stands.
  const psiAware = all.map((d) =>
    d.id === "pageExperience" ? applyPsiToPageExperience(d, psi) : d,
  );

  const overallScore = computeOverallScore(psiAware);
  const pageScores = composePageScores(crawl.pages, psiAware);

  const { scored, informational } = splitDimensions(psiAware);

  return {
    url: crawl.baseUrl,
    timestamp: new Date().toISOString(),
    siteType: crawl.siteType,
    pagesAudited: crawl.pages.length,
    overallScore,
    grade: gradeFromScore(overallScore),
    dimensions: scored,
    informational,
    engineVersion: ENGINE_VERSION,
    priorities: generatePriorities(psiAware),
    emailSecurity,
    pageScores,
  };
}
