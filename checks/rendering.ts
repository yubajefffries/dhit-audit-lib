import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

export function checkRendering(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    const info = parseHTML(page.html, page.url);
    let pageScore = 0;

    if (info.bodyTextLength > 500) {
      pageScore += 40;
      const f: Finding = {
        type: "pass",
        message: `Rich text content (${info.bodyTextLength} chars)`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    } else if (info.bodyTextLength > 100) {
      pageScore += 25;
      const f: Finding = {
        type: "warning",
        message: `Limited text content (${info.bodyTextLength} chars)`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    } else {
      const f: Finding = {
        type: "fail",
        message: `Very little text in HTML source (${info.bodyTextLength} chars)`,
        page: page.path,
        detail:
          "Little source text was observed. The rendered DOM was not measured; check whether meaningful content depends on JavaScript.",
      };
      findings.push(f);
      pageFindings.push(f);
    }

    const isSPA = /<div id="(root|app|__next)">\s*<\/div>/i.test(page.html);
    if (isSPA && info.bodyTextLength < 200) {
      const f: Finding = {
        type: "fail",
        message: "SPA detected with minimal pre-rendered content",
        page: page.path,
        detail: "Consider SSR/SSG for AI crawler visibility",
      };
      findings.push(f);
      pageFindings.push(f);
      pageScore = Math.min(pageScore, 20);
    }

    // Framework markers do not prove rendering. Ordinary static HTML receives
    // the same credit for meaningful source content, without needing noscript.
    if (info.bodyTextLength > 100 && info.headings.length > 0) {
      pageScore += 40;
      const f: Finding = {
        type: "pass", message: "Text and headings are present in the HTML source",
        detail: "Static source inspection only. CSS visibility and the JavaScript-rendered DOM were not compared.",
        page: page.path,
      };
      findings.push(f); pageFindings.push(f);
    }

    if (info.headings.length > 0) {
      pageScore += 20;
    }

    const clamped = Math.min(100, Math.max(0, pageScore));
    totalScore += clamped;
    perPage.push({ url: page.url, path: page.path, title: page.title, score: clamped, findings: pageFindings });
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;

  return {
    id: "rendering",
    name: "Server-Rendered Content",
    weight: 0.10,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: false,
    pages: perPage,
  };
}
