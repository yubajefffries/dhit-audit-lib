import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRobotsTxt, isCrawlerBlocked } from "../robots-parser";
import { parseHTML } from "../parsers";
import { checkRendering } from "../checks/rendering";
import { checkSchema } from "../checks/schema";
import { checkSitemap } from "../checks/sitemap";
import { checkRobots } from "../checks/robots";
import { checkPageExperience, applyPsiToPageExperience } from "../checks/page-experience";

const blocked = (text: string, bot = "Googlebot", path = "/") => isCrawlerBlocked(parseRobotsTxt(text), bot, path);
test("robots groups, precedence, repeated groups, comments and empty directives", () => {
  const shared = "User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: / # comment";
  assert(blocked(shared)); assert(blocked(shared, "Bingbot"));
  assert(!blocked("User-agent: *\nDisallow: /\nUser-agent: Googlebot\nDisallow:"));
  assert(!blocked("User-agent: Googlebot\nDisallow: /\nUser-agent: Googlebot\nAllow: /"));
  assert(!blocked("User-agent: *\nDisallow: /\nAllow: /"));
  assert(blocked("User-agent: Googlebot\nAllow: /\nUser-agent: Googlebot-News\nDisallow: /", "Googlebot-News"));
});
test("robots longest path, wildcard, anchors, case and percent-encoded paths", () => {
  const rules = "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$";
  assert(blocked(rules, "Bingbot", "/private/file"));
  assert(!blocked(rules, "Bingbot", "/private/public/a"));
  assert(blocked(rules, "Bingbot", "/doc.pdf"));
  assert(!blocked(rules, "Bingbot", "/doc.pdf?download=1"));
  assert(!blocked(rules, "Bingbot", "/Private/file"));
  assert(blocked("User-agent: *\nDisallow: /%70rivate", "Bingbot", "/private"));
  assert(!blocked("User-agent: *\nDisallow: /a%2Fb", "Bingbot", "/a/b"));
  assert(checkRobots(rules, ["/private"]).findings.some((f) => f.type === "fail"));
});
const page = (html: string) => ({ html, url: "https://example.test/", path: "/", title: "Fixture", statusCode: 200 });
test("script/style/template/hidden text does not inflate visible source content", () => {
  const hidden = "payload ".repeat(500);
  const html = `<body><h1>Visible</h1><script>${hidden}</script><style>${hidden}</style><template>${hidden}</template><div hidden>${hidden}</div></body>`;
  assert.equal(parseHTML(html, "https://example.test").bodyText, "Visible");
  assert(checkRendering([page(html)]).score < 50);
  const staticHtml = `<h1>Heading</h1><p>${"Visible text ".repeat(100)}</p>`;
  assert.equal(checkRendering([page(staticHtml)]).score, 100);
  assert.equal(checkRendering([page(staticHtml + '<script>self.__next_f=[]</script>')]).score, 100);
});
test("JSON-LD graph types inherit context; scalar JSON is ignored safely", () => {
  const graph = { "@context": "https://schema.org", "@graph": [{ "@type": ["Organization", "WebPage"] }, { "@graph": [{ "@type": "WebSite" }] }] };
  const result = checkSchema([page(`<script type="application/ld+json">${JSON.stringify(graph)}</script><script type="application/ld+json">null</script>`)]);
  assert(!result.findings.some((f) => /missing @context/.test(f.message)));
  assert(result.findings.some((f) => /Organization, WebPage, WebSite/.test(f.message)));
  assert(result.findings.some((f) => /not Schema.org validation/.test(f.detail ?? "")));
});
test("sitemap coverage uses exact URLs and identifies child references", () => {
  const xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/elsewhere</loc></url></urlset>';
  const result = checkSitemap(xml, null, [page("")]);
  assert(result.findings.some((f) => /0\/1 pages listed/.test(f.message)));
  assert(!result.findings.some((f) => /Valid XML/.test(f.message)));
  const index = checkSitemap('<sitemapindex><sitemap><loc>https://example.test/child.xml</loc></sitemap></sitemapindex>', null, [page("")]);
  assert(index.findings.some((f) => /child sitemap references/.test(f.message)));
  assert(!index.findings.some((f) => /coverage/.test(f.message)));
});
test("static page experience labels provenance, including PSI unavailable", () => {
  const dimension = checkPageExperience([page("<h1>Fixture</h1>")]);
  assert.equal(dimension.measurementSource, "static");
  assert.equal(applyPsiToPageExperience(dimension, null).measurementSource, "static");
});
