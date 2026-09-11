import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";
import type { PsiResult, CwvMetric } from "./psi";

/**
 * Page Experience ; Pillar C of Google Search Essentials + AI Mandate 2.
 *
 * Per Google: page experience (responsive, fast, low CLS) is part of the
 * helpful-content signals their AI surfaces use to weigh source quality.
 *
 * Two scoring modes:
 *
 *   1. `checkPageExperience(pages)` ; STATIC heuristic, always available.
 *      Approximates page experience from the HTML response:
 *        - HTTPS ; required
 *        - <meta name="viewport"> ; required for mobile
 *        - HTML payload size
 *        - Render-blocking <script> tags in <head>
 *        - Inline <style> bytes
 *
 *   2. `applyPsiToPageExperience(dimension, psi)` ; when PageSpeed Insights
 *      returned real Core Web Vitals (LCP, INP, CLS) for the audited origin,
 *      this replaces the static score with one derived from PSI's Lighthouse
 *      performance score, and folds in CrUX field data if available.
 *
 * Deep audits run PSI in parallel with the crawl, so when the audit finishes
 * the user sees real CWV. Lite audits and audits without a PSI key fall back
 * to the static heuristic ; graceful degradation either way.
 *
 * Source: https://developers.google.com/search/docs/appearance/core-web-vitals
 * Source: https://developers.google.com/search/docs/appearance/page-experience
 * Source: https://web.dev/articles/vitals (LCP / INP / CLS thresholds)
 */

const HTML_SIZE_OK = 200 * 1024; // 200KB
const HTML_SIZE_WARN = 500 * 1024; // 500KB
const HTML_SIZE_FAIL = 1024 * 1024; // 1MB

const INLINE_STYLE_WARN = 30 * 1024; // 30KB of inline <style>

export function checkPageExperience(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    let pageScore = 100;

    // 1. HTTPS
    let isHttps = false;
    try {
      isHttps = new URL(page.url).protocol === "https:";
    } catch {
      // unparseable URL ; treat as failure
    }
    if (!isHttps) {
      pageScore -= 30;
      pageFindings.push({
        type: "fail",
        message: "Page served over HTTP (not HTTPS)",
        detail:
          "Google requires HTTPS for full ranking eligibility and many browser features. Issue a certificate and enforce HTTPS redirects.",
        page: page.url,
      });
    }

    const { $ } = parseHTML(page.html, page.url);

    // 2. Viewport meta
    const viewport = $('meta[name="viewport"]').attr("content")?.toLowerCase() ?? "";
    if (!viewport) {
      pageScore -= 20;
      pageFindings.push({
        type: "fail",
        message: "Missing viewport meta tag",
        detail:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>. Without it, Google treats the page as non-mobile-friendly.',
        page: page.url,
      });
    } else if (!viewport.includes("width=device-width")) {
      pageScore -= 10;
      pageFindings.push({
        type: "warning",
        message: "Viewport meta missing width=device-width",
        detail: `Found: "${viewport}". Recommended: "width=device-width, initial-scale=1".`,
        page: page.url,
      });
    }

    // 3. HTML payload size
    const htmlBytes = Buffer.byteLength(page.html, "utf8");
    if (htmlBytes > HTML_SIZE_FAIL) {
      pageScore -= 20;
      pageFindings.push({
        type: "fail",
        message: `HTML payload very large (${(htmlBytes / 1024).toFixed(0)} KB)`,
        detail:
          "Over 1 MB of HTML usually means inline data, generated boilerplate, or unsplit critical CSS. Hurts LCP on mobile networks.",
        page: page.url,
      });
    } else if (htmlBytes > HTML_SIZE_WARN) {
      pageScore -= 10;
      pageFindings.push({
        type: "warning",
        message: `HTML payload large (${(htmlBytes / 1024).toFixed(0)} KB)`,
        detail:
          "Above 500 KB tends to slow LCP on mobile. Consider extracting CSS, deferring scripts, or splitting the page.",
        page: page.url,
      });
    } else if (htmlBytes > HTML_SIZE_OK) {
      // No penalty, no warning ; just info
      pageFindings.push({
        type: "info",
        message: `HTML payload ${(htmlBytes / 1024).toFixed(0)} KB`,
        page: page.url,
      });
    }

    // 4. Render-blocking head scripts
    const blockingHeadScripts = $("head script[src]")
      .filter((_, el) => {
        const $el = $(el);
        return !$el.attr("async") && !$el.attr("defer") && $el.attr("type") !== "module";
      }).length;
    if (blockingHeadScripts >= 5) {
      pageScore -= 15;
      pageFindings.push({
        type: "fail",
        message: `${blockingHeadScripts} render-blocking scripts in <head>`,
        detail:
          "Each blocking script in <head> delays first paint. Add async/defer, or move non-critical scripts to the end of <body>.",
        page: page.url,
      });
    } else if (blockingHeadScripts >= 2) {
      pageScore -= 8;
      pageFindings.push({
        type: "warning",
        message: `${blockingHeadScripts} render-blocking scripts in <head>`,
        detail: "Add async/defer to scripts that don't need to run before render.",
        page: page.url,
      });
    }

    // 5. Inline style budget
    let inlineStyleBytes = 0;
    $("style").each((_, el) => {
      inlineStyleBytes += Buffer.byteLength($(el).text(), "utf8");
    });
    if (inlineStyleBytes > INLINE_STYLE_WARN) {
      pageScore -= 5;
      pageFindings.push({
        type: "warning",
        message: `${(inlineStyleBytes / 1024).toFixed(0)} KB of inline <style>`,
        detail:
          "Large inline stylesheets bloat every HTML response. Move shared CSS to an external file with proper caching.",
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

    const topFail = pageFindings.find((f) => f.type === "fail");
    if (topFail) findings.push(topFail);
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;
  if (findings.length === 0) {
    findings.push({
      type: "pass",
      message: "Page experience signals look healthy across audited pages",
    });
  } else {
    findings.push({
      type: "info",
      message:
        "Static heuristic. If PageSpeed Insights data is available, it will be merged in below with real LCP / INP / CLS values.",
    });
  }

  return {
    id: "pageExperience",
    measurementSource: "static",
    name: "Page Experience",
    weight: 0.1,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: false,
    pages: perPage,
  };
}

// ---------------------------------------------------------------------------
// PSI merge ; replaces the static heuristic with real Core Web Vitals when
// PageSpeed Insights returned data for the audited origin.
// ---------------------------------------------------------------------------

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function metricFinding(
  label: string,
  metric: CwvMetric,
  formatter: (n: number) => string,
  threshold: string,
): Finding {
  const type: Finding["type"] =
    metric.category === "good"
      ? "pass"
      : metric.category === "needs-improvement"
        ? "warning"
        : "fail";
  return {
    type,
    message: `${label}: ${formatter(metric.value)} (${metric.category})`,
    detail: `Google threshold for "good": ${threshold}.`,
  };
}

/**
 * Merges PSI results into a pageExperience DimensionResult. Returns a NEW
 * DimensionResult ; does not mutate the input.
 *
 * - The dimension `score` becomes the Lighthouse performance score (0-100),
 *   a lab performance metric, not a search ranking or citation score.
 * - Per-page scores are left intact (static heuristic still applies to each
 *   crawled page).
 * - Findings are augmented with LCP / INP / CLS / TTFB rows, labelled as
 *   "lab" (Lighthouse) or "field" (CrUX real-user) data.
 *
 * If `psi` is null, the input dimension is returned unchanged.
 */
export function applyPsiToPageExperience(
  dimension: DimensionResult,
  psi: PsiResult | null,
): DimensionResult {
  if (!psi) return dimension;

  const newFindings: Finding[] = [];

  newFindings.push({
    type: "info",
    message: `PageSpeed Insights (${psi.strategy}) ; Lighthouse performance score: ${psi.performanceScore}/100`,
    detail: psi.hasFieldData
      ? "Includes CrUX field data from real users on this origin."
      : "Lab data only ; origin doesn't have enough real-user samples for CrUX field data yet.",
  });

  // Lab metrics
  newFindings.push(
    metricFinding("LCP (lab)", psi.lcp, formatMs, "≤ 2.5s"),
  );
  if (psi.inp) {
    newFindings.push(
      metricFinding("INP (lab)", psi.inp, formatMs, "≤ 200ms"),
    );
  }
  newFindings.push(
    metricFinding(
      "CLS (lab)",
      psi.cls,
      (n) => n.toFixed(3),
      "≤ 0.1",
    ),
  );
  if (psi.ttfb) {
    newFindings.push(
      metricFinding("TTFB (lab)", psi.ttfb, formatMs, "≤ 800ms"),
    );
  }

  // Field metrics (CrUX real-user data) ; only when present
  if (psi.fieldData) {
    newFindings.push({
      type: "info",
      message: "Real-user (CrUX) field data:",
    });
    if (psi.fieldData.lcp) {
      newFindings.push(
        metricFinding("LCP (field, 75th pct)", psi.fieldData.lcp, formatMs, "≤ 2.5s"),
      );
    }
    if (psi.fieldData.inp) {
      newFindings.push(
        metricFinding("INP (field, 75th pct)", psi.fieldData.inp, formatMs, "≤ 200ms"),
      );
    }
    if (psi.fieldData.cls) {
      newFindings.push(
        metricFinding(
          "CLS (field, 75th pct)",
          psi.fieldData.cls,
          (n) => n.toFixed(3),
          "≤ 0.1",
        ),
      );
    }
  }

  // Retain the static-heuristic findings under a section header so users still
  // see the underlying signals (HTTPS, viewport, payload size, etc.).
  newFindings.push({
    type: "info",
    message: "Static signals (also applied to per-page scores):",
  });
  for (const f of dimension.findings) {
    // Drop the placeholder line that hinted PSI would arrive ; it just did.
    if (
      f.type === "info" &&
      f.message.startsWith("Static heuristic. If PageSpeed Insights")
    ) {
      continue;
    }
    newFindings.push(f);
  }

  return {
    ...dimension,
    measurementSource: "psi",
    score: psi.performanceScore,
    grade: gradeFromScore(psi.performanceScore),
    findings: newFindings,
  };
}
