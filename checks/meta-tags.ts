import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

const REQUIRED_TAGS = [
  { key: "title", label: "Title tag" },
  { key: "metaDescription", label: "Meta description" },
  { key: "canonical", label: "Canonical link" },
  { key: "ogTitle", label: "og:title" },
  { key: "ogDescription", label: "og:description" },
  { key: "ogUrl", label: "og:url" },
  { key: "ogType", label: "og:type" },
  { key: "ogImage", label: "og:image" },
] as const;

export function checkMetaTags(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    const info = parseHTML(page.html, page.url);
    let pageScore = 0;
    const missing: string[] = [];

    for (const tag of REQUIRED_TAGS) {
      const value = info[tag.key as keyof typeof info];
      if (value && typeof value === "string" && value.trim().length > 0) {
        pageScore += 12.5;
      } else {
        missing.push(tag.label);
      }
    }

    if (info.metaDescription) {
      if (info.metaDescription.length < 50) {
        const f: Finding = {
          type: "warning",
          message: `Meta description too short (${info.metaDescription.length} chars)`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
        pageScore -= 5;
      } else if (info.metaDescription.length > 160) {
        const f: Finding = {
          type: "warning",
          message: `Meta description too long (${info.metaDescription.length} chars)`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
        pageScore -= 3;
      }
    }

    if (info.title && (info.title === "Untitled" || info.title.length < 5)) {
      const f: Finding = {
        type: "warning",
        message: `Generic or short title: "${info.title}"`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
      pageScore -= 5;
    }

    if (missing.length === 0) {
      const f: Finding = { type: "pass", message: "All 8 meta tags present", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    } else {
      const f: Finding = {
        type: missing.length > 4 ? "fail" : "warning",
        message: `Missing: ${missing.join(", ")}`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    }

    const clamped = Math.min(100, Math.max(0, Math.round(pageScore)));
    totalScore += clamped;
    perPage.push({ url: page.url, path: page.path, title: page.title, score: clamped, findings: pageFindings });
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;

  return {
    id: "meta",
    name: "Meta & Canonical",
    weight: 0.10,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
    pages: perPage,
  };
}
