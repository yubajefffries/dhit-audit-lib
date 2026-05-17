import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

export function checkSemantic(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    const info = parseHTML(page.html, page.url);
    let pageScore = 0;

    if (info.h1s.length === 1) {
      pageScore += 25;
      const f: Finding = { type: "pass", message: "Single H1 tag", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    } else if (info.h1s.length === 0) {
      const f: Finding = { type: "fail", message: "No H1 tag found", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    } else {
      const f: Finding = {
        type: "warning",
        message: `Multiple H1 tags (${info.h1s.length})`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
      pageScore += 10;
    }

    let hierarchyOk = true;
    for (let i = 1; i < info.headings.length; i++) {
      if (info.headings[i].level > info.headings[i - 1].level + 1) {
        hierarchyOk = false;
        const f: Finding = {
          type: "warning",
          message: `Skipped heading level: h${info.headings[i - 1].level} → h${info.headings[i].level}`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
        break;
      }
    }
    if (hierarchyOk && info.headings.length > 1) {
      pageScore += 20;
      const f: Finding = { type: "pass", message: "Correct heading hierarchy", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    }

    const semanticElements = [
      { name: "main", has: info.hasMain },
      { name: "nav", has: info.hasNav },
      { name: "header", has: info.hasHeader },
      { name: "footer", has: info.hasFooter },
    ];

    const presentSemantic = semanticElements.filter((e) => e.has);
    const missingSemantic = semanticElements.filter((e) => !e.has);

    if (presentSemantic.length === semanticElements.length) {
      pageScore += 30;
      const f: Finding = { type: "pass", message: "All semantic landmarks present", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    } else if (presentSemantic.length > 0) {
      pageScore += presentSemantic.length * 7;
      const f: Finding = {
        type: "warning",
        message: `Missing semantic elements: ${missingSemantic.map((e) => `<${e.name}>`).join(", ")}`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    } else {
      const f: Finding = { type: "fail", message: "No semantic HTML landmarks found", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    }

    if (info.totalImgs > 0) {
      if (info.imgsWithoutAlt === 0) {
        pageScore += 15;
        const f: Finding = { type: "pass", message: `All ${info.totalImgs} images have alt text`, page: page.path };
        findings.push(f);
        pageFindings.push(f);
      } else {
        const f: Finding = {
          type: "warning",
          message: `${info.imgsWithoutAlt}/${info.totalImgs} images missing alt text`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
        pageScore += Math.round(15 * (1 - info.imgsWithoutAlt / info.totalImgs));
      }
    } else {
      pageScore += 15;
    }

    if (info.hasArticle || info.hasSection) {
      pageScore += 10;
    }

    const clamped = Math.min(100, Math.max(0, pageScore));
    totalScore += clamped;
    perPage.push({ url: page.url, path: page.path, title: page.title, score: clamped, findings: pageFindings });
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;

  return {
    id: "semantic",
    name: "Semantic HTML",
    weight: 0.10,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: false,
    pages: perPage,
  };
}
