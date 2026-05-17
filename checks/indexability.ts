import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

/**
 * Indexability — Pillar A of Google Search Essentials.
 *
 * Per Google: "If a page can't be indexed by Google Search, it cannot be cited
 * by Google AI." AI Overviews and AI Mode retrieve from the regular Google
 * Search index, so anything that blocks indexing also blocks AI citation.
 *
 * Per-page signals checked:
 *   - HTTP 200 status (page.statusCode)
 *   - <meta name="robots" content="..."> does NOT include `noindex` or `none`
 *   - X-Robots-Tag is not checked here (would need response headers; the
 *     crawler doesn't currently surface them. TODO for Phase 4.)
 *   - <link rel="canonical"> is present, has a reasonable URL, and is not
 *     pointing to a completely unrelated host (canonical loops, etc.)
 *
 * Site-level robots.txt Disallow:/ is already covered by the robots dimension,
 * so it's not re-scored here.
 *
 * Source: https://developers.google.com/search/docs/essentials/technical
 * Source: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
 */
export function checkIndexability(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    let pageScore = 100;

    const status = page.statusCode;
    if (typeof status === "number" && status >= 400) {
      pageScore -= 60;
      pageFindings.push({
        type: "fail",
        message: `Returned HTTP ${status}`,
        detail:
          "Pages must return 200 OK to be eligible for the Google index. Fix the response or redirect to a canonical 200 page.",
        page: page.url,
      });
    } else if (typeof status === "number" && status >= 300 && status < 400) {
      pageScore -= 20;
      pageFindings.push({
        type: "warning",
        message: `Returned HTTP ${status} (redirect)`,
        detail:
          "Redirect chains slow indexing and can drop signals. Prefer one 301 to the final URL.",
        page: page.url,
      });
    }

    const { $ } = parseHTML(page.html, page.url);

    const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
    const googlebotMeta = $('meta[name="googlebot"]').attr("content")?.toLowerCase() ?? "";
    const directives = `${robotsMeta} ${googlebotMeta}`;

    if (directives.includes("noindex") || directives.includes("none")) {
      pageScore -= 60;
      pageFindings.push({
        type: "fail",
        message: "Page is set to noindex",
        detail:
          'Found <meta name="robots" content="noindex"> (or equivalent). This explicitly tells Google not to index the page. Remove if the page should be public.',
        page: page.url,
      });
    } else if (robotsMeta || googlebotMeta) {
      pageFindings.push({
        type: "info",
        message: "Robots meta tag present (indexing allowed)",
        page: page.url,
      });
    }

    if (directives.includes("nofollow")) {
      pageScore -= 5;
      pageFindings.push({
        type: "warning",
        message: "Page-level nofollow set",
        detail:
          "Google won't follow outgoing links from this page. Usually unintentional on content pages.",
        page: page.url,
      });
    }

    const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
    if (!canonical) {
      pageScore -= 10;
      pageFindings.push({
        type: "warning",
        message: "No canonical link",
        detail:
          'Add <link rel="canonical" href="..."> pointing to the preferred URL for this page. Prevents duplicate-content dilution.',
        page: page.url,
      });
    } else {
      // Validate canonical resolves and isn't pointing at a different host
      try {
        const resolved = new URL(canonical, page.url);
        const pageHost = new URL(page.url).hostname.replace(/^www\./, "");
        const canonHost = resolved.hostname.replace(/^www\./, "");
        if (canonHost !== pageHost) {
          pageScore -= 15;
          pageFindings.push({
            type: "warning",
            message: `Canonical points to a different host (${canonHost})`,
            detail:
              "Cross-host canonicals are valid in rare cases (syndication) but usually a misconfiguration.",
            page: page.url,
          });
        } else {
          pageFindings.push({
            type: "pass",
            message: "Canonical present and same-host",
            page: page.url,
          });
        }
      } catch {
        pageScore -= 10;
        pageFindings.push({
          type: "warning",
          message: "Canonical URL is malformed",
          detail: `Could not parse: ${canonical}`,
          page: page.url,
        });
      }
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

    // Promote the most-severe per-page finding to site-level if it's a fail
    const topFail = pageFindings.find((f) => f.type === "fail");
    if (topFail) findings.push(topFail);
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;
  if (findings.length === 0) {
    findings.push({
      type: "pass",
      message: "All audited pages are indexable",
    });
  }

  return {
    id: "indexability",
    name: "Indexability & Crawl Eligibility",
    weight: 0.15,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
    pages: perPage,
  };
}
