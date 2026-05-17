import type { DimensionResult, Finding, PageData } from "../types";
import { gradeFromScore } from "../constants";

export function checkSitemap(
  sitemapXml: string | null,
  robotsTxt: string | null,
  pages: PageData[],
): DimensionResult {
  const findings: Finding[] = [];

  if (!sitemapXml) {
    findings.push({ type: "fail", message: "No sitemap.xml found" });
    return {
      id: "sitemap",
      name: "sitemap.xml",
      weight: 0.05,
      score: 0,
      grade: "F",
      findings,
      fixable: true,
    };
  }

  findings.push({ type: "pass", message: "sitemap.xml exists" });
  let score = 30;

  const hasNamespace = sitemapXml.includes("sitemaps.org/schemas/sitemap");
  if (hasNamespace) {
    score += 15;
    findings.push({ type: "pass", message: "Valid XML namespace" });
  } else {
    findings.push({
      type: "warning",
      message: "Missing standard sitemap namespace",
    });
  }

  const locMatches = sitemapXml.match(/<loc>([^<]+)<\/loc>/g) || [];
  const sitemapUrls = locMatches.map((m) =>
    m.replace(/<\/?loc>/g, "").trim(),
  );

  if (sitemapUrls.length === 0) {
    findings.push({ type: "fail", message: "No URLs found in sitemap" });
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: `${sitemapUrls.length} URLs in sitemap`,
    });

    const coveredPages = pages.filter((p) =>
      sitemapUrls.some(
        (su) => su.includes(p.path) || p.url.includes(su) || su === p.url,
      ),
    );

    if (pages.length > 0) {
      const coverage = coveredPages.length / pages.length;
      if (coverage >= 0.8) {
        score += 15;
        findings.push({
          type: "pass",
          message: `Good page coverage: ${coveredPages.length}/${pages.length}`,
        });
      } else {
        findings.push({
          type: "warning",
          message: `Partial coverage: ${coveredPages.length}/${pages.length} pages listed`,
        });
        score += 5;
      }
    }
  }

  const hasLastmod = /<lastmod>[^<]+<\/lastmod>/.test(sitemapXml);
  if (hasLastmod) {
    score += 10;
    findings.push({ type: "pass", message: "lastmod dates present" });
  } else {
    findings.push({
      type: "warning",
      message: "No lastmod dates in sitemap",
    });
  }

  if (robotsTxt && /sitemap/i.test(robotsTxt)) {
    score += 15;
    findings.push({ type: "pass", message: "Referenced in robots.txt" });
  } else {
    findings.push({
      type: "warning",
      message: "Not referenced in robots.txt",
    });
  }

  score = Math.min(100, Math.max(0, score));

  return {
    id: "sitemap",
    name: "sitemap.xml",
    weight: 0.05,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
  };
}
