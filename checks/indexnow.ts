import type { DimensionResult, Finding, PageData } from "../types";

/**
 * IndexNow Adoption — INFORMATIONAL ONLY (does not affect the score).
 *
 * IndexNow is Microsoft's open protocol for pushing URL changes to search
 * engines instantly. Currently adopted by Bing, Yandex, Naver, and Seznam.
 * Google has NOT endorsed it.
 *
 * Adoption usually shows up as:
 *   - A key file at https://yoursite.com/{key}.txt (the file name IS the key)
 *   - A reference in robots.txt or HTML <head>
 *   - A CMS plugin or platform integration (Cloudflare, Rank Math, Yoast)
 *
 * Why it matters: content gets discovered in Bing's index in minutes instead
 * of days, which materially affects how quickly Microsoft's grounding layer
 * can surface it to Copilot, ChatGPT search, Perplexity, Brave, etc.
 *
 * We probe weak signals from existing crawl data (homepage HTML + robots.txt).
 * For a definitive check, run the crawler against `https://yoursite.com/.well-known/indexnow.txt`
 * or against the configured key file directly.
 *
 * Source: https://www.indexnow.org/
 * Source: https://www.bing.com/indexnow
 */
export function checkIndexNow(
  robotsTxt: string | null,
  pages: PageData[],
): DimensionResult {
  const findings: Finding[] = [];

  const robotsMentionsIndexNow = robotsTxt
    ? /indexnow/i.test(robotsTxt)
    : false;

  const homepage = pages[0]?.html ?? "";
  const homepageMentionsIndexNow = /indexnow/i.test(homepage);

  // CMS / platform fingerprints
  const platformSignals: string[] = [];
  if (/cloudflare/i.test(homepage) && homepageMentionsIndexNow) {
    platformSignals.push("Cloudflare auto-IndexNow");
  }
  if (/rank-math|rankmath/i.test(homepage) && homepageMentionsIndexNow) {
    platformSignals.push("Rank Math IndexNow");
  }
  if (/yoast/i.test(homepage) && homepageMentionsIndexNow) {
    platformSignals.push("Yoast IndexNow");
  }

  findings.push({
    type: "info",
    message:
      "IndexNow is Microsoft's protocol for pushing URL changes to Bing in real time.",
    detail:
      "Adopted by Bing, Yandex, Naver, Seznam. Google has not endorsed it. Not required, but useful if you publish often and want Microsoft-grounded AI products (Copilot, ChatGPT search, Perplexity, Brave) to discover new content quickly.",
  });

  if (robotsMentionsIndexNow || homepageMentionsIndexNow) {
    findings.push({
      type: "info",
      message: "Detected: IndexNow signals present on the site.",
      detail:
        platformSignals.length > 0
          ? `Likely integration: ${platformSignals.join(", ")}.`
          : "Found mentions of IndexNow in HTML or robots.txt. Verify the key file resolves at https://yoursite.com/{key}.txt.",
    });
  } else {
    findings.push({
      type: "info",
      message: "Not detected: no IndexNow signals on the site.",
      detail:
        "If you publish frequently and want to be discovered by Bing-grounded AI products faster, consider enabling IndexNow. Most major CMS platforms (WordPress via Rank Math/Yoast, Cloudflare via the IndexNow app, Wix, Duda) have one-click options.",
    });
  }

  findings.push({
    type: "info",
    message:
      "To measure post-adoption impact, register the site in Bing Webmaster Tools and watch the AI Performance Dashboard (Mar 2026).",
    detail:
      "Bing Webmaster Tools: https://www.bing.com/webmasters/  ·  IndexNow protocol docs: https://www.indexnow.org/",
  });

  return {
    id: "indexNow",
    name: "IndexNow Adoption (Informational)",
    weight: 0,
    score: 0,
    grade: "—",
    findings,
    fixable: true,
    informational: true,
    googleQuote:
      "IndexNow is a Microsoft / Bing protocol. Google has not adopted it.",
    googleSource: "https://www.indexnow.org/",
  };
}
