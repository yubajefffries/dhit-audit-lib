import type { DimensionResult, Finding } from "../types";
import { AI_CRAWLERS, gradeFromScore } from "../constants";

import { parseRobotsTxt, isCrawlerBlocked } from "../robots-parser";

/**
 * checkRobots; SCORED.
 *
 * Per Google Search Essentials (Pillar A), the requirement is crawlability ;
 * Googlebot must be able to reach indexable pages, and the sitemap should be
 * discoverable. We score on:
 *   - File presence
 *   - Sitemap directive present
 *   - Googlebot (and Bingbot for completeness) not globally Disallowed
 *
 * The 17-bot AI crawler allow-list moved to checkAiCrawlers (informational).
 *
 * Source: https://developers.google.com/search/docs/essentials/technical
 */
export function checkRobots(robotsTxt: string | null, paths: string[] = ["/"]): DimensionResult {
  const findings: Finding[] = [];

  if (!robotsTxt) {
    findings.push({
      type: "warning",
      message: "No robots.txt found",
      detail:
        "A robots.txt file is optional, but recommended. Add one at /robots.txt that references your sitemap and allows Googlebot.",
    });
    // A missing robots.txt means crawlers default to allowed, so this isn't
    // a hard failure; just below ideal. Score 50.
    return {
      id: "robots",
      name: "robots.txt",
      weight: 0.08,
      score: 50,
      grade: gradeFromScore(50),
      findings,
      fixable: true,
    };
  }

  findings.push({ type: "pass", message: "robots.txt exists" });
  const rules = parseRobotsTxt(robotsTxt);
  let score = 50;

  const hasSitemap = /^Sitemap:\s*.+/im.test(robotsTxt);
  if (hasSitemap) {
    score += 20;
    findings.push({ type: "pass", message: "Sitemap directive present" });
  } else {
    findings.push({
      type: "warning",
      message: "No Sitemap directive in robots.txt",
      detail:
        "Add `Sitemap: https://yoursite.com/sitemap.xml` so Googlebot and Bingbot can find your sitemap directly.",
    });
  }

  const googlebotBlocked = paths.some((path) => isCrawlerBlocked(rules, "Googlebot", path));
  const bingbotBlocked = paths.some((path) => isCrawlerBlocked(rules, "Bingbot", path));

  // Googlebot; gateway to Google Search, AI Overviews, AI Mode, Gemini grounded results
  if (googlebotBlocked) {
    findings.push({
      type: "fail",
      message: "Googlebot is blocked on one or more sampled paths",
      detail:
        "Matching robots rules restrict Googlebot on sampled paths. Check whether those restrictions are intentional. This does not establish indexing or citation status.",
    });
    score = Math.min(score, 15);
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: "No Googlebot block found on sampled paths",
    });
  }

  // Bingbot; gateway to Bing, Microsoft Copilot, ChatGPT search, Perplexity, Brave, DuckDuckGo, You.com
  if (bingbotBlocked) {
    findings.push({
      type: "fail",
      message: "Bingbot is blocked on one or more sampled paths",
      detail:
        "Matching robots rules restrict Bingbot on sampled paths. Preserve intentional restrictions; this does not establish indexing or visibility across AI products.",
    });
    score = Math.min(score, 30);
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: "No Bingbot block found on sampled paths",
    });
  }

  score = Math.min(100, Math.max(0, score));

  return {
    id: "robots",
    name: "robots.txt",
    weight: 0.08,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
  };
}

/**
 * checkAiCrawlers; INFORMATIONAL ONLY (does not affect the score).
 *
 * Surfaces whether the site explicitly allows or blocks third-party AI
 * crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.).
 *
 * This is NOT a Google AI search signal. Google's AI Overviews and AI Mode
 * use the regular Google index; Googlebot's access is what matters for
 * Google AI citation eligibility. The third-party crawler allow-list is
 * about training-data access for OpenAI / Anthropic / Perplexity / etc.
 *
 * We surface this so site owners can make an informed choice, but it does
 * not affect their score.
 */
export function checkAiCrawlers(robotsTxt: string | null): DimensionResult {
  const findings: Finding[] = [];

  findings.push({
    type: "info",
    message:
      "Third-party AI crawler access is not a Google AI search signal.",
    detail:
      "Google's AI Overviews and AI Mode use the regular Google Search index; Googlebot's access is what matters for Google AI citation eligibility. The bots below (GPTBot, ClaudeBot, etc.) affect whether third-party AI products can use your content for training or in their own answers. This check is informational and does not affect your score.",
  });

  if (!robotsTxt) {
    findings.push({
      type: "info",
      message: "No robots.txt; third-party AI crawlers default to allowed.",
    });
    return {
      id: "aiCrawlers",
      name: "Third-Party AI Crawler Allow-List (Informational)",
      weight: 0,
      score: 0,
      grade: "Not scored",
      findings,
      fixable: false,
      informational: true,
      googleQuote:
        "Our generative AI features on Google Search are rooted in our core Search ranking and quality systems.",
      googleSource:
        "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
    };
  }

  const rules = parseRobotsTxt(robotsTxt);

  const allowedCrawlers: string[] = [];
  const blockedCrawlers: string[] = [];
  const unlistedCrawlers: string[] = [];

  for (const crawler of AI_CRAWLERS) {
    const hasSpecificRule = rules.some(
      (r) => r.userAgent.toLowerCase() === crawler.toLowerCase(),
    );
    const isBlocked = isCrawlerBlocked(rules, crawler);

    if (isBlocked) {
      blockedCrawlers.push(crawler);
    } else if (hasSpecificRule) {
      allowedCrawlers.push(crawler);
    } else {
      unlistedCrawlers.push(crawler);
    }
  }

  if (allowedCrawlers.length > 0) {
    findings.push({
      type: "info",
      message: `${allowedCrawlers.length} third-party AI crawlers with specific rules allowing the root path`,
      detail: allowedCrawlers.join(", "),
    });
  }
  if (blockedCrawlers.length > 0) {
    findings.push({
      type: "info",
      message: `${blockedCrawlers.length} third-party AI crawlers blocked at the root path`,
      detail: blockedCrawlers.join(", "),
    });
  }
  if (unlistedCrawlers.length > 0) {
    findings.push({
      type: "info",
      message: `${unlistedCrawlers.length} third-party AI crawlers without specific rules; root path allowed by fallback policy`,
      detail: unlistedCrawlers.join(", "),
    });
  }

  return {
    id: "aiCrawlers",
    name: "Third-Party AI Crawler Allow-List (Informational)",
    weight: 0,
    score: 0,
    grade: "Not scored",
    findings,
    fixable: false,
    informational: true,
    googleQuote:
      "Our generative AI features on Google Search are rooted in our core Search ranking and quality systems.",
    googleSource:
      "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
  };
}
