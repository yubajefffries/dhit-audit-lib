import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiteAudit } from "../scorer";
import { checkIndexability } from "../checks/indexability";
import { checkAiSurfaceCoverage } from "../checks/ai-surface-coverage";
import type { CrawlResult } from "../types";

test("lite keeps page-level evidence without deep scoring or page grouping", () => {
  const crawl: CrawlResult = {
    baseUrl: "https://example.test", siteType: "business",
    robotsTxt: null, sitemapXml: null, llmsTxt: null, llmsFullTxt: null,
    pages: [{ url: "https://example.test/missing", path: "/missing", title: "Missing", html: "<html><body>Missing</body></html>", statusCode: 404 }],
  };
  const result = runLiteAudit(crawl);
  const indexability = result.dimensions.find((d) => d.id === "indexability")!;
  for (const f of checkIndexability(crawl.pages).pages![0].findings) {
    assert(indexability.findings.some((actual) => actual.message === f.message && actual.detail === f.detail && actual.page === (f.page ?? crawl.pages[0].url)), f.message);
  }
  assert(indexability.findings.some((f) => /canonical/i.test(f.message)));
  assert.equal(result.dimensions.length, 11);
  assert.equal(result.informational?.length, 4);
  assert(result.dimensions.every((d) => !d.pages));
  assert.equal(result.pageScores, undefined);
  assert.equal(result.emailSecurity, undefined);
});

test("crawler-rule observations mark absent data unknown and avoid product visibility verdicts", () => {
  for (const input of [null, "", "User-agent: Bingbot\nDisallow: /", "User-agent: *\nAllow: /"]) {
    const result = checkAiSurfaceCoverage(input);
    assert.equal(result.weight, 0);
    assert.equal(result.informational, true);
    assert.equal(result.fixable, false);
    assert.equal(result.findings.length, 3);
    const messages = result.findings.map((f) => f.message).join(" ");
    assert(!/eligible|can currently see|ChatGPT|Perplexity/.test(messages));
    if (!input) assert.equal(result.findings.filter((f) => /unknown/.test(f.message)).length, 2);
  }
});
