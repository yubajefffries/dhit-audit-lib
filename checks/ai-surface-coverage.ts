import type { DimensionResult, Finding } from "../types";

/** Informational robots observations only, not a measurement of AI visibility. */

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

export function checkAiSurfaceCoverage(robotsTxt: string | null): DimensionResult {
  const rules = robotsTxt ? parseRobotsTxt(robotsTxt) : [];
  const findings: Finding[] = [{
    type: "info",
    message: "AI visibility was not measured. These observations inspect only simplified robots.txt rules.",
    detail: "Crawler rules do not establish actual access, indexing, retrieval, or citations. Page directives, authentication, WAF behavior, and full robots group/path semantics are not checked here. No product-by-product coverage is inferred.",
  }];
  for (const bot of ["Googlebot", "Bingbot"]) {
    findings.push({
      type: "info",
      message: !robotsTxt
        ? `${bot}: unknown (robots.txt unavailable or empty).`
        : isBlocked(rules, bot)
          ? `${bot}: a root-wide Disallow rule was detected by the simplified parser.`
          : `${bot}: no root-wide block was detected by the simplified parser.`,
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
