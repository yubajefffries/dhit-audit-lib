import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

/**
 * Internal Linking & Site Architecture ; Pillar C of Google Search Essentials.
 *
 * Per Google: "Make sure that other pages on the web link to your site" and
 * "Make your links crawlable". Internal linking is how Googlebot (and AI
 * crawlers) traverse a site. Poor internal linking creates orphan pages that
 * never get discovered, and deep pages that take many clicks to reach get
 * crawled less often.
 *
 * Per-page signals:
 *   - Outgoing internal-link count (orphan-out is a serious problem)
 *   - Reachability depth from the homepage (BFS)
 *   - Whether anything in the crawl links INTO this page (orphan-in warning)
 *
 * Source: https://developers.google.com/search/docs/crawling-indexing/links-crawlable
 */

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    let path = u.pathname;
    if (path !== "/" && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    u.pathname = path;
    return u.href;
  } catch {
    return url;
  }
}

export function checkInternalLinking(
  pages: PageData[],
  baseUrl: string,
): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];

  if (pages.length === 0) {
    return {
      id: "internalLinking",
      name: "Internal Linking & Site Architecture",
      weight: 0.05,
      score: 0,
      grade: "F",
      findings: [{ type: "fail", message: "No pages were crawled" }],
      fixable: true,
      pages: [],
    };
  }

  const home = normalize(baseUrl);
  const knownUrls = new Set(pages.map((p) => normalize(p.url)));

  // Build outgoing-link map: url -> Set of internal urls it links to (restricted to crawled set)
  const outgoing = new Map<string, Set<string>>();
  for (const page of pages) {
    const { links } = parseHTML(page.html, page.url);
    const normalizedLinks = new Set(links.map(normalize));
    outgoing.set(normalize(page.url), normalizedLinks);
  }

  // Build incoming-link map (for orphan-in detection): url -> count of pages linking here
  const incoming = new Map<string, number>();
  for (const [, outs] of outgoing) {
    for (const target of outs) {
      if (!knownUrls.has(target)) continue;
      incoming.set(target, (incoming.get(target) ?? 0) + 1);
    }
  }

  // BFS depth from homepage
  const depth = new Map<string, number>();
  if (knownUrls.has(home)) {
    const queue: string[] = [home];
    depth.set(home, 0);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const d = depth.get(current)!;
      const outs = outgoing.get(current) ?? new Set();
      for (const target of outs) {
        if (!knownUrls.has(target)) continue;
        if (depth.has(target)) continue;
        depth.set(target, d + 1);
        queue.push(target);
      }
    }
  }

  let totalScore = 0;
  let deepPages = 0;
  let orphanInPages = 0;
  let orphanOutPages = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    let pageScore = 100;
    const url = normalize(page.url);
    const outs = outgoing.get(url) ?? new Set();
    const outCount = outs.size;
    const inCount = incoming.get(url) ?? 0;
    const pageDepth = depth.get(url);

    if (outCount === 0) {
      pageScore -= 30;
      orphanOutPages++;
      pageFindings.push({
        type: "fail",
        message: "No outgoing internal links",
        detail:
          "This page is a dead end. Add navigation or contextual links to other pages on the site so Googlebot and users can continue.",
        page: page.url,
      });
    } else if (outCount < 3) {
      pageScore -= 10;
      pageFindings.push({
        type: "warning",
        message: `Only ${outCount} outgoing internal link${outCount === 1 ? "" : "s"}`,
        detail:
          "Most pages should link to at least a few related pages (related content, parent section, calls to action).",
        page: page.url,
      });
    } else {
      pageFindings.push({
        type: "pass",
        message: `${outCount} outgoing internal links`,
        page: page.url,
      });
    }

    if (url !== home && inCount === 0) {
      pageScore -= 15;
      orphanInPages++;
      pageFindings.push({
        type: "warning",
        message: "No other audited page links to this one (orphan-in)",
        detail:
          "Pages with no incoming internal links get crawled and indexed less often. Add a link from a related page or your main navigation.",
        page: page.url,
      });
    }

    if (pageDepth === undefined && url !== home) {
      pageScore -= 20;
      pageFindings.push({
        type: "warning",
        message: "Not reachable from the homepage by following links",
        detail:
          "The page is in the sitemap or was discovered via crawl, but no internal link chain from / leads here.",
        page: page.url,
      });
    } else if (pageDepth !== undefined && pageDepth > 3) {
      pageScore -= 10;
      deepPages++;
      pageFindings.push({
        type: "warning",
        message: `${pageDepth} clicks from homepage`,
        detail:
          "Google recommends important pages be within 3 clicks of the homepage so they're crawled often.",
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

  if (orphanOutPages > 0) {
    findings.push({
      type: "fail",
      message: `${orphanOutPages} page${orphanOutPages === 1 ? "" : "s"} have no outgoing internal links`,
    });
  }
  if (orphanInPages > 0) {
    findings.push({
      type: "warning",
      message: `${orphanInPages} page${orphanInPages === 1 ? "" : "s"} are not linked to from anywhere in the audited set`,
    });
  }
  if (deepPages > 0) {
    findings.push({
      type: "warning",
      message: `${deepPages} page${deepPages === 1 ? "" : "s"} are more than 3 clicks from the homepage`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      type: "pass",
      message: "Internal linking looks healthy across audited pages",
    });
  }

  return {
    id: "internalLinking",
    name: "Internal Linking & Site Architecture",
    weight: 0.05,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
    pages: perPage,
  };
}
