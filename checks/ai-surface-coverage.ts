import type { DimensionResult, Finding } from "../types";

/** Informational robots observations only, not a measurement of AI visibility. */

import { parseRobotsTxt, isCrawlerBlocked } from "../robots-parser";

export function checkAiSurfaceCoverage(robotsTxt: string | null): DimensionResult {
  const rules = robotsTxt ? parseRobotsTxt(robotsTxt) : [];
  const findings: Finding[] = [{
    type: "info",
    message: "AI visibility was not measured. These observations inspect robots.txt rules at the root path.",
    detail: "Crawler rules do not establish actual access, indexing, retrieval, or citations. Page directives, authentication, WAF behavior, and access to unsampled paths are not checked here. No product-by-product coverage is inferred.",
  }];
  for (const bot of ["Googlebot", "Bingbot"]) {
    findings.push({
      type: "info",
      message: !robotsTxt
        ? `${bot}: unknown (robots.txt unavailable or empty).`
        : isCrawlerBlocked(rules, bot)
          ? `${bot}: a matching rule blocks the root path.`
          : `${bot}: no matching block was found at the root path.`,
      detail: "This observation is not proof that the crawler can access the site. Check actual requests and indexing in the relevant webmaster tools.",
    });
  }
  return {
    id: "aiSurfaceCoverage",
    name: "Search Crawler Rules (Informational)",
    weight: 0,
    score: 0,
    grade: "Not scored",
    findings,
    fixable: false,
    informational: true,
  };
}
