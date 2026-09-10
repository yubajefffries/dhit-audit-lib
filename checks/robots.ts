import type { DimensionResult, Finding } from "../types";
import { AI_CRAWLERS, gradeFromScore } from "../constants";

interface RobotsRule {
  userAgent: string;
  rules: { type: "allow" | "disallow"; path: string }[];
}

function parseRobotsTxt(content: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let currentAgent: string | null = null;
  let currentRules: { type: "allow" | "disallow"; path: string }[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("#") || line === "") continue;

    const uaMatch = line.match(/^User-agent:\s*(.+)/i);
    if (uaMatch) {
      if (currentAgent !== null) {
        rules.push({ userAgent: currentAgent, rules: currentRules });
      }
      currentAgent = uaMatch[1].trim();
      currentRules = [];
      continue;
    }

    const allowMatch = line.match(/^Allow:\s*(.*)/i);
    if (allowMatch && currentAgent !== null) {
      currentRules.push({ type: "allow", path: allowMatch[1].trim() });
      continue;
    }

    const disallowMatch = line.match(/^Disallow:\s*(.*)/i);
    if (disallowMatch && currentAgent !== null) {
      const path = disallowMatch[1].trim();
      if (path) {
        currentRules.push({ type: "disallow", path });
      }
      continue;
    }
  }

  if (currentAgent !== null) {
    rules.push({ userAgent: currentAgent, rules: currentRules });
  }

  return rules;
}

function isCrawlerBlocked(
  rules: RobotsRule[],
  crawlerName: string,
): boolean {
  const specificRule = rules.find(
    (r) => r.userAgent.toLowerCase() === crawlerName.toLowerCase(),
  );
  if (specificRule) {
    const hasDisallowAll = specificRule.rules.some(
      (r) => r.type === "disallow" && r.path === "/",
    );
    const hasAllowAll = specificRule.rules.some(
      (r) => r.type === "allow" && r.path === "/",
    );
    if (hasDisallowAll && !hasAllowAll) return true;
    if (hasAllowAll) return false;
  }

  const wildcardRule = rules.find((r) => r.userAgent === "*");
  if (wildcardRule) {
    const hasDisallowAll = wildcardRule.rules.some(
      (r) => r.type === "disallow" && r.path === "/",
    );
    if (hasDisallowAll) return true;
  }

  return false;
}

/**
 * checkRobots — SCORED.
 *
 * Per Google Search Essentials (Pillar A), the requirement is crawlability —
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
export function checkRobots(robotsTxt: string | null): DimensionResult {
  const findings: Finding[] = [];

  if (!robotsTxt) {
    findings.push({
      type: "warning",
      message: "No robots.txt found",
      detail:
        "A robots.txt file is optional, but recommended. Add one at /robots.txt that references your sitemap and allows Googlebot.",
    });
    // A missing robots.txt means crawlers default to allowed, so this isn't
    // a hard failure — just below ideal. Score 50.
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

  const googlebotBlocked = isCrawlerBlocked(rules, "Googlebot");
  const bingbotBlocked = isCrawlerBlocked(rules, "Bingbot");

  // Googlebot — gateway to Google Search, AI Overviews, AI Mode, Gemini grounded results
  if (googlebotBlocked) {
    findings.push({
      type: "fail",
      message: "Googlebot is blocked from your site",
      detail:
        "This is the single biggest crawl-eligibility problem you can have. Without Googlebot access, the site cannot appear in Google Search, AI Overviews, AI Mode, or Gemini grounded results.",
    });
    score = Math.min(score, 15);
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: "Googlebot is allowed (Google Search + AI Overviews + AI Mode + Gemini)",
    });
  }

  // Bingbot — gateway to Bing, Microsoft Copilot, ChatGPT search, Perplexity, Brave, DuckDuckGo, You.com
  if (bingbotBlocked) {
    findings.push({
      type: "fail",
      message: "Bingbot is blocked from your site",
      detail:
        "The simplified parser detected a root-wide Bingbot block. This may restrict Bing crawling, but does not establish indexing status or visibility across AI products.",
    });
    score = Math.min(score, 30);
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: "Bingbot is allowed (Bing + Copilot + ChatGPT search + Perplexity + Brave + DuckDuckGo)",
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
 * checkAiCrawlers — INFORMATIONAL ONLY (does not affect the score).
 *
 * Surfaces whether the site explicitly allows or blocks third-party AI
 * crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.).
 *
 * This is NOT a Google AI search signal. Google's AI Overviews and AI Mode
 * use the regular Google index — Googlebot's access is what matters for
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
      "Google's AI Overviews and AI Mode use the regular Google Search index — Googlebot's access is what matters for Google AI citation eligibility. The bots below (GPTBot, ClaudeBot, etc.) affect whether third-party AI products can use your content for training or in their own answers. This check is informational and does not affect your score.",
  });

  if (!robotsTxt) {
    findings.push({
      type: "info",
      message: "No robots.txt — third-party AI crawlers default to allowed.",
    });
    return {
      id: "aiCrawlers",
      name: "Third-Party AI Crawler Allow-List (Informational)",
      weight: 0,
      score: 0,
      grade: "—",
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
      message: `${allowedCrawlers.length} third-party AI crawlers explicitly allowed`,
      detail: allowedCrawlers.join(", "),
    });
  }
  if (blockedCrawlers.length > 0) {
    findings.push({
      type: "info",
      message: `${blockedCrawlers.length} third-party AI crawlers explicitly blocked`,
      detail: blockedCrawlers.join(", "),
    });
  }
  if (unlistedCrawlers.length > 0) {
    findings.push({
      type: "info",
      message: `${unlistedCrawlers.length} third-party AI crawlers not listed (default = allowed)`,
      detail: unlistedCrawlers.join(", "),
    });
  }

  return {
    id: "aiCrawlers",
    name: "Third-Party AI Crawler Allow-List (Informational)",
    weight: 0,
    score: 0,
    grade: "—",
    findings,
    fixable: false,
    informational: true,
    googleQuote:
      "Our generative AI features on Google Search are rooted in our core Search ranking and quality systems.",
    googleSource:
      "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
  };
}
