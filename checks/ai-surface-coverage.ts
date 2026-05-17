import type { DimensionResult, Finding } from "../types";

/**
 * AI Surface Coverage — INFORMATIONAL ONLY (does not affect the score).
 *
 * Synthesizes existing robots.txt signals into per-surface verdicts so users
 * can see at a glance which AI products can currently see and cite their site.
 *
 * Bing's index powers a large chunk of the non-Google AI ecosystem:
 *   - Microsoft Copilot (formerly Bing Chat)
 *   - Microsoft 365 Copilot web answers
 *   - ChatGPT search (per OpenAI's Bing licensing)
 *   - Perplexity (primary grounding source)
 *   - Brave Search AI
 *   - DuckDuckGo AI
 *   - You.com
 *
 * Google's AI surfaces (AI Overviews, AI Mode, Gemini grounded results) use
 * the Google index, so they need Googlebot access.
 *
 * Some AI products use their own crawlers in addition to or instead of the
 * search-engine index (GPTBot for ChatGPT training, ClaudeBot for Anthropic,
 * PerplexityBot for Perplexity's own crawl) — those are separate signals.
 *
 * This check renders the picture; it does not add a separate score. The
 * underlying access verdicts already affect the `robots` dimension score.
 *
 * Sources:
 *   - https://about.ads.microsoft.com/en/blog/post/march-2026/the-ai-performance-dashboard-your-view-into-where-your-brand-appears-across-the-ai-web
 *   - https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
 */

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
      if (path) currentRules.push({ type: "disallow", path });
      continue;
    }
  }
  if (currentAgent !== null) {
    rules.push({ userAgent: currentAgent, rules: currentRules });
  }
  return rules;
}

function isBlocked(rules: RobotsRule[], name: string): boolean {
  const specific = rules.find((r) => r.userAgent.toLowerCase() === name.toLowerCase());
  if (specific) {
    const hasDisallowAll = specific.rules.some((r) => r.type === "disallow" && r.path === "/");
    const hasAllowAll = specific.rules.some((r) => r.type === "allow" && r.path === "/");
    if (hasDisallowAll && !hasAllowAll) return true;
    if (hasAllowAll) return false;
  }
  const wildcard = rules.find((r) => r.userAgent === "*");
  if (wildcard) {
    if (wildcard.rules.some((r) => r.type === "disallow" && r.path === "/")) return true;
  }
  return false;
}

interface SurfaceVerdict {
  name: string;
  groundedOn: string;
  verdict: "covered" | "blocked" | "unknown";
  reason: string;
}

export function checkAiSurfaceCoverage(robotsTxt: string | null): DimensionResult {
  const findings: Finding[] = [];

  // If no robots.txt, all bots default to allowed.
  const rules = robotsTxt ? parseRobotsTxt(robotsTxt) : [];
  const googlebotBlocked = robotsTxt ? isBlocked(rules, "Googlebot") : false;
  const bingbotBlocked = robotsTxt ? isBlocked(rules, "Bingbot") : false;

  const surfaces: SurfaceVerdict[] = [
    {
      name: "Google AI Overviews & AI Mode",
      groundedOn: "Googlebot / Google Search index",
      verdict: googlebotBlocked ? "blocked" : "covered",
      reason: googlebotBlocked
        ? "Googlebot is blocked in robots.txt — Google AI surfaces cannot retrieve this site."
        : "Googlebot can reach the site; eligible for Google's AI surfaces.",
    },
    {
      name: "Gemini grounded results",
      groundedOn: "Google Search index",
      verdict: googlebotBlocked ? "blocked" : "covered",
      reason: googlebotBlocked
        ? "Gemini grounding uses Google Search — blocked alongside AI Overviews."
        : "Gemini grounding uses Google Search; Googlebot access satisfies this.",
    },
    {
      name: "Microsoft Copilot",
      groundedOn: "Bingbot / Bing index",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "Bingbot is blocked — Microsoft Copilot cannot ground answers from this site."
        : "Bingbot can reach the site; eligible for Copilot grounding.",
    },
    {
      name: "ChatGPT search",
      groundedOn: "Bingbot / Bing index (per OpenAI licensing)",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "ChatGPT search uses Bing's index — blocked when Bingbot is."
        : "ChatGPT search uses Bing's index; Bingbot access satisfies this.",
    },
    {
      name: "Perplexity",
      groundedOn: "Bingbot / Bing index (primary)",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "Perplexity's primary grounding source is Bing — blocked when Bingbot is."
        : "Perplexity grounds primarily on Bing; Bingbot access satisfies this.",
    },
    {
      name: "Brave Search AI",
      groundedOn: "Bingbot / Bing index",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "Brave AI grounds on Bing — blocked when Bingbot is."
        : "Brave AI grounds on Bing; Bingbot access satisfies this.",
    },
    {
      name: "DuckDuckGo AI",
      groundedOn: "Bingbot / Bing index",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "DuckDuckGo's AI uses Bing — blocked when Bingbot is."
        : "DuckDuckGo's AI uses Bing; Bingbot access satisfies this.",
    },
    {
      name: "You.com",
      groundedOn: "Bingbot / Bing index",
      verdict: bingbotBlocked ? "blocked" : "covered",
      reason: bingbotBlocked
        ? "You.com grounds on Bing — blocked when Bingbot is."
        : "You.com grounds on Bing; Bingbot access satisfies this.",
    },
  ];

  const covered = surfaces.filter((s) => s.verdict === "covered");
  const blocked = surfaces.filter((s) => s.verdict === "blocked");

  findings.push({
    type: "info",
    message: `${covered.length} of ${surfaces.length} AI surfaces can currently see this site.`,
    detail:
      "Each row below shows a major AI product, what search index it grounds on, and whether your current robots.txt lets that index see your pages. Citation isn't guaranteed — grounding selection also depends on content quality and authority — but eligibility starts here.",
  });

  for (const s of surfaces) {
    findings.push({
      type: "info",
      message: `${s.verdict === "covered" ? "✓" : "✗"} ${s.name} — ${s.groundedOn}`,
      detail: s.reason,
    });
  }

  if (blocked.length > 0) {
    findings.push({
      type: "info",
      message:
        "Fix: edit robots.txt so the relevant crawler is no longer Disallowed. See the robots.txt dimension above for specifics.",
    });
  }

  findings.push({
    type: "info",
    message:
      "To measure actual AI citations after fixing eligibility: register the site in Google Search Console AND Bing Webmaster Tools — Bing's AI Performance Dashboard (Mar 2026) reports total citations, grounding queries, and per-page citation activity across the Microsoft-grounded surfaces.",
    detail:
      "Bing Webmaster Tools: https://www.bing.com/webmasters/  ·  Search Console: https://search.google.com/search-console",
  });

  return {
    id: "aiSurfaceCoverage",
    name: "AI Surface Coverage (Informational)",
    weight: 0,
    score: 0,
    grade: "—",
    findings,
    fixable: true,
    informational: true,
    googleQuote:
      "Our generative AI features on Google Search are rooted in our core Search ranking and quality systems.",
    googleSource:
      "https://about.ads.microsoft.com/en/blog/post/march-2026/the-ai-performance-dashboard-your-view-into-where-your-brand-appears-across-the-ai-web",
  };
}
