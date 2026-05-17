import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { gradeFromScore } from "../constants";

export function checkAeoContent(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    let pageScore = 0;

    const hasSummary =
      /class\s*=\s*["'][^"']*(?:summary|tldr|intro|excerpt)[^"']*["']/i.test(
        page.html,
      ) ||
      /id\s*=\s*["'][^"']*(?:summary|tldr)[^"']*["']/i.test(page.html);

    if (hasSummary) {
      pageScore += 20;
      const f: Finding = { type: "pass", message: "Has summary/TL;DR section", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    } else {
      const f: Finding = {
        type: "warning",
        message: "No TL;DR or summary block found near page top",
        page: page.path,
        detail: "Add a 2-sentence summary after the H1",
      };
      findings.push(f);
      pageFindings.push(f);
    }

    const html = page.html.toLowerCase();
    const hasFaq =
      html.includes("faq") ||
      /<details/i.test(page.html) ||
      /FAQPage/i.test(page.html);
    if (hasFaq) {
      pageScore += 15;
      const f: Finding = { type: "pass", message: "FAQ section detected", page: page.path };
      findings.push(f);
      pageFindings.push(f);
    }

    const paragraphs = page.html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    const paragraphTexts = paragraphs
      .map((p) => p.replace(/<[^>]+>/g, "").trim())
      .filter((t) => t.length > 20);

    if (paragraphTexts.length > 0) {
      const avgWords =
        paragraphTexts.reduce((acc, p) => acc + p.split(/\s+/).length, 0) /
        paragraphTexts.length;
      if (avgWords <= 50) {
        pageScore += 20;
        const f: Finding = {
          type: "pass",
          message: `Short paragraphs (avg ${Math.round(avgWords)} words)`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
      } else if (avgWords <= 100) {
        pageScore += 10;
        const f: Finding = {
          type: "warning",
          message: `Medium paragraph length (avg ${Math.round(avgWords)} words)`,
          page: page.path,
          detail: "Break into shorter paragraphs for better AI extraction",
        };
        findings.push(f);
        pageFindings.push(f);
      } else {
        const f: Finding = {
          type: "fail",
          message: `Long paragraphs (avg ${Math.round(avgWords)} words)`,
          page: page.path,
          detail: "Dense text walls reduce AI answer extraction quality",
        };
        findings.push(f);
        pageFindings.push(f);
      }
    }

    const listCount = (page.html.match(/<(?:ul|ol)[^>]*>/gi) || []).length;
    if (listCount > 0) {
      pageScore += 15;
      const f: Finding = {
        type: "pass",
        message: `${listCount} lists for scannable content`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    }

    const hasDirectAnswer =
      hasSummary ||
      (paragraphTexts.length > 0 &&
        paragraphTexts[0].split(/[.!?]/).length <= 3);
    if (hasDirectAnswer) {
      pageScore += 15;
    }

    const hasCitations =
      /cite|source|reference|bibliography/i.test(page.html) ||
      /<a[^>]*>.*?(?:\[\d+\]|source|citation)/i.test(page.html);
    if (hasCitations) {
      pageScore += 15;
      const f: Finding = {
        type: "pass",
        message: "Citations or references detected",
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    }

    const clamped = Math.min(100, Math.max(0, pageScore));
    totalScore += clamped;
    perPage.push({ url: page.url, path: page.path, title: page.title, score: clamped, findings: pageFindings });
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;

  return {
    id: "aeo",
    name: "Content Structure & Helpfulness",
    weight: 0.15,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: false,
    pages: perPage,
  };
}
