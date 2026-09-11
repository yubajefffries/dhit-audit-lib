import type { DimensionResult, Finding, PageData, PerPageScore } from "../types";
import { parseHTML } from "../parsers";
import { gradeFromScore } from "../constants";

const EXPECTED_SCHEMAS: Record<string, string[]> = {
  home: ["Organization", "WebSite"],
  about: ["Organization", "BreadcrumbList"],
  services: ["Service", "BreadcrumbList"],
  products: ["Product", "BreadcrumbList"],
  blog: ["CollectionPage", "BreadcrumbList"],
  post: ["BlogPosting", "Article", "BreadcrumbList"],
  contact: ["ContactPage", "BreadcrumbList"],
  faq: ["FAQPage", "BreadcrumbList"],
};

function guessPageType(url: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path === "/" || path === "") return "home";
  if (/about/i.test(path)) return "about";
  // Nonprofits and agencies commonly publish their offerings under
  // /programs/ rather than /services/ ; same page type, same expectations.
  if (/service|program/i.test(path)) return "services";
  if (/product/i.test(path)) return "products";
  if (/blog\/?$/i.test(path)) return "blog";
  if (/blog\/.+|post\/.+|article/i.test(path)) return "post";
  if (/contact/i.test(path)) return "contact";
  if (/faq/i.test(path)) return "faq";
  return "other";
}

function getSchemaTypes(jsonLd: Array<Record<string, unknown>>): string[] {
  return jsonLd
    .map((item) => {
      const type = item["@type"];
      if (Array.isArray(type)) return type.filter((value): value is string => typeof value === "string");
      if (typeof type === "string") return [type];
      return [];
    })
    .flat();
}

export function checkSchema(pages: PageData[]): DimensionResult {
  const findings: Finding[] = [{ type: "info", message: "JSON-LD syntax and type observations only", detail: "This is not Schema.org validation or Google rich-result validation. URL-based type suggestions may not fit the actual page." }];
  const perPage: PerPageScore[] = [];
  let totalScore = 0;
  let pagesWithSchema = 0;

  for (const page of pages) {
    const pageFindings: Finding[] = [];
    const { jsonLd } = parseHTML(page.html, page.url);
    const types = getSchemaTypes(jsonLd);
    const pageType = guessPageType(page.url);

    if (jsonLd.length === 0) {
      const f: Finding = { type: "fail", message: "No parseable JSON-LD objects found", page: page.path };
      findings.push(f);
      pageFindings.push(f);
      perPage.push({ url: page.url, path: page.path, title: page.title, score: 0, findings: pageFindings });
      continue;
    }

    pagesWithSchema++;
    let pageScore = 60;

    for (const item of jsonLd) {
      if (!item["@context"] || !item["@type"]) {
        const f: Finding = {
          type: "warning",
          message: "JSON-LD missing @context or @type",
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
        pageScore -= 10;
      }
    }

    const expected = EXPECTED_SCHEMAS[pageType];
    if (expected) {
      const hasExpected = expected.some((e) => types.includes(e));
      if (hasExpected) {
        pageScore += 20;
        const f: Finding = {
          type: "pass",
          message: `Recognized schema types for the URL-based page guess: ${types.join(", ")}`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
      } else {
        const f: Finding = {
          type: "warning",
          message: `URL-based heuristic suggests ${expected.join(" or ")}; found: ${types.join(", ") || "none"}`,
          page: page.path,
        };
        findings.push(f);
        pageFindings.push(f);
      }
    } else if (types.includes("WebPage") && types.includes("BreadcrumbList")) {
      // Pages the path heuristic cannot classify were hard-capped at 70 even
      // with correct markup. A page-level WebPage node plus breadcrumbs is the
      // right generic structure, so award the same credit typed pages get.
      pageScore += 20;
      const f: Finding = {
        type: "pass",
        message: `Has page-level schema: ${types.join(", ")}`,
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
    }

    if (pageType !== "home" && !types.includes("BreadcrumbList")) {
      const f: Finding = {
        type: "warning",
        message: "Missing BreadcrumbList schema",
        page: page.path,
      };
      findings.push(f);
      pageFindings.push(f);
      pageScore -= 5;
    }

    if (types.includes("WebPage")) {
      pageScore += 10;
    }

    const clamped = Math.min(100, Math.max(0, pageScore));
    totalScore += clamped;
    perPage.push({ url: page.url, path: page.path, title: page.title, score: clamped, findings: pageFindings });
  }

  const score = pages.length > 0 ? Math.round(totalScore / pages.length) : 0;

  if (pagesWithSchema === 0) {
    findings.unshift({
      type: "fail",
      message: "No JSON-LD structured data found on any page",
    });
  } else if (pagesWithSchema < pages.length) {
    findings.unshift({
      type: "warning",
      message: `JSON-LD found on ${pagesWithSchema}/${pages.length} pages`,
    });
  } else {
    findings.unshift({
      type: "pass",
      message: `JSON-LD found on all ${pages.length} pages`,
    });
  }

  return {
    id: "schema",
    name: "Schema.org JSON-LD",
    weight: 0.07,
    score,
    grade: gradeFromScore(score),
    findings,
    fixable: true,
    pages: perPage,
  };
}
