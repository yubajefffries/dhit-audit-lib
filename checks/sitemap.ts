import * as cheerio from "cheerio";
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
    findings.push({ type: "pass", message: "Standard sitemap namespace marker present" });
  } else {
    findings.push({
      type: "warning",
      message: "Missing standard sitemap namespace",
    });
  }

  // XML mode extracts structure/entities but is tolerant, not a validator.
  const $ = cheerio.load(sitemapXml, { xmlMode: true });
  const isIndex = $("sitemapindex").length > 0;
  const sitemapUrls = $(isIndex ? "sitemapindex > sitemap > loc" : "urlset > url > loc")
    .map((_, el) => $(el).text().trim()).get();
  findings.push({ type: "info", message: "Sitemap structure observations only", detail: "XML well-formedness, protocol validity, fetchability and date accuracy are not validated. Child sitemaps are not fetched." });
  const normalize = (url: string) => { try { const u = new URL(url); u.hash = ""; return u.href; } catch { return ""; } };

  if (sitemapUrls.length === 0) {
    findings.push({ type: "fail", message: "No URLs found in sitemap" });
  } else {
    score += 15;
    findings.push({
      type: "pass",
      message: `${sitemapUrls.length} ${isIndex ? "child sitemap references" : "page URLs"} in sitemap`,
    });

    const coveredPages = pages.filter((p) =>
      sitemapUrls.some(
        (su) => normalize(su) !== "" && normalize(su) === normalize(p.url),
      ),
    );

    if (!isIndex && pages.length > 0) {
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
    findings.push({ type: "pass", message: "lastmod values present; accuracy not verified" });
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
