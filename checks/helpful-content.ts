import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

/**
 * Helpful Content & Spam Self-Check ; Pillar B (Spam Policies) + AI Mandate 1
 * (Valuable, non-commodity content) of the Google AI Optimization Guide.
 *
 * This is the "would anyone miss this page if it disappeared?" check. Google
 * explicitly calls out scaled content abuse, near-duplicate pages targeting
 * query permutations, and thin commodity content as red flags for both
 * regular Search and AI Overviews.
 *
 * Per-page signals (static heuristics):
 *   - Word count (thin-content detection)
 *   - Author / byline signal (E-E-A-T proxy)
 *   - Original imagery present
 *
 * Site-level signals:
 *   - Duplicate titles across pages (a classic scaled-content tell)
 *
 * Source: https://developers.google.com/search/docs/essentials/spam-policies
 * Source: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
 */

const THIN_WORDS = 300;
const LIGHT_WORDS = 500;

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function hasByline($: ReturnType<typeof parseHTML>["$"]): boolean {
  return (
    $('meta[name="author"]').length > 0 ||
    $('link[rel="author"]').length > 0 ||
    $('[rel="author"]').length > 0 ||
    $('[itemtype*="schema.org/Person"]').length > 0 ||
    $('[class*="author"]').length > 0 ||
    $('[class*="byline"]').length > 0
  );
}

export function checkHelpfulContent(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];

  if (pages.length === 0) {
    return {
      id: "helpfulContent",
      name: "Helpful Content & Spam Self-Check",
      weight: 0.05,
      score: 0,
      grade: "F",
      findings: [{ type: "fail", message: "No pages were crawled" }],
      fixable: false,
      pages: [],
    };
  }

  // Pre-pass: collect titles for site-level duplicate detection
  const titleCounts = new Map<string, number>();
  for (const page of pages) {
    const t = page.title.trim().toLowerCase();
    if (!t) continue;
    titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  }
  const duplicateTitles = new Set(
    [...titleCounts.entries()].filter(([, c]) => c > 1).map(([t]) => t),
  );

  let totalScore = 0;
  let thinPages = 0;
  let noBylinePages = 0;
  let noImageryPages = 0;
  let dupTitlePages = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    let pageScore = 100;
    const { $, bodyText, totalImgs } = parseHTML(page.html, page.url);

    const words = countWords(bodyText);

    if (words < THIN_WORDS) {
      pageScore -= 40;
      thinPages++;
      pageFindings.push({
        type: "fail",
        message: `Thin content (${words} words)`,
        detail:
          "Under 300 words usually signals a placeholder or scaled-content page. Either expand with original insight or noindex this page.",
        page: page.url,
      });
    } else if (words < LIGHT_WORDS) {
      pageScore -= 15;
      pageFindings.push({
        type: "warning",
        message: `Light content (${words} words)`,
        detail:
          "Most genuinely helpful pages are 500+ words. Add specifics, examples, or first-hand context if appropriate.",
        page: page.url,
      });
    } else {
      pageFindings.push({
        type: "pass",
        message: `${words} words of content`,
        page: page.url,
      });
    }

    if (!hasByline($)) {
      pageScore -= 5;
      noBylinePages++;
      pageFindings.push({
        type: "info",
        message: "No author / byline signal detected",
        detail:
          "Google's helpful-content guidance emphasizes E-E-A-T ; knowing who wrote it. Add an author byline or meta[name=\"author\"] on content pages.",
        page: page.url,
      });
    }

    if (totalImgs === 0) {
      pageScore -= 10;
      noImageryPages++;
      pageFindings.push({
        type: "warning",
        message: "No images on the page",
        detail:
          "Original media (photos, diagrams, screenshots) is a strong helpful-content signal. Pure text pages compete poorly in AI Overviews.",
        page: page.url,
      });
    }

    const t = page.title.trim().toLowerCase();
    if (t && duplicateTitles.has(t)) {
      pageScore -= 25;
      dupTitlePages++;
      pageFindings.push({
        type: "fail",
        message: "Title is identical to another page on this site",
        detail: `"${page.title}" ; duplicate titles confuse Googlebot about which URL to rank and can trigger scaled-content flags. Rewrite each title to be page-specific.`,
        page: page.url,
      });
    }

    const clamped = Math.max(0, Math.min(100, Math.round(pageScore)));
    totalScore += clamped;
    perPage.push({
      url: page.url,
      path: page.path,
      title: page.title,
      score: clamped,
      findings: pageFindings,
    });
  }

  const score = Math.round(totalScore / pages.length);

  if (thinPages > 0) {
    findings.push({
      type: "fail",
      message: `${thinPages} page${thinPages === 1 ? "" : "s"} under 300 words (thin content)`,
    });
  }
  if (dupTitlePages > 0) {
    findings.push({
      type: "fail",
      message: `${dupTitlePages} page${dupTitlePages === 1 ? "" : "s"} share a title with another audited page`,
    });
  }
  if (noImageryPages > 0) {
    findings.push({
      type: "warning",
      message: `${noImageryPages} page${noImageryPages === 1 ? "" : "s"} have no images at all`,
    });
  }
  if (noBylinePages > 0) {
    findings.push({
      type: "info",
      message: `${noBylinePages} page${noBylinePages === 1 ? "" : "s"} have no detected author/byline signal`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      type: "pass",
      message: "Helpful-content signals look healthy across audited pages",
    });
  }

  return {
    id: "helpfulContent",
    name: "Helpful Content & Spam Self-Check",
    weight: 0.05,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: false,
    pages: perPage,
  };
}
