import * as cheerio from "cheerio";
import type { CrawlResult, PageData } from "./types";
import { extractInternalLinks, detectSiteType } from "./parsers";
import { MAX_PAGES_TO_DISCOVER } from "./constants";

import { fetchBounded, MAX_HTML_BYTES, MAX_TEXT_BYTES } from "./safe-fetch";

async function fetchPage(url: string): Promise<{ html: string; status: number } | null> {
  try {
    const result = await fetchBounded(url, { maxBytes: MAX_HTML_BYTES, timeoutMs: 15000, htmlOnly: true });
    return { html: result.body, status: result.status };
  } catch {
    return null;
  }
}

async function fetchTextFile(url: string): Promise<string | null> {
  try {
    const result = await fetchBounded(url, { maxBytes: MAX_TEXT_BYTES, timeoutMs: 10000 });
    return result.status >= 200 && result.status < 300 ? result.body : null;
  } catch {
    return null;
  }
}

export interface CrawlOptions {
  /** Max pages to discover beyond the root. Defaults to MAX_PAGES_TO_DISCOVER. */
  maxPages?: number;
}

export async function crawlSite(
  inputUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? MAX_PAGES_TO_DISCOVER;

  let baseUrl = inputUrl.trim();
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = "https://" + baseUrl;
  }
  if (
    baseUrl.endsWith("/") &&
    baseUrl !== "https://" &&
    baseUrl !== "http://"
  ) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const parsedBase = new URL(baseUrl);
  const origin = parsedBase.origin;

  const rootResult = await fetchPage(baseUrl);
  if (!rootResult || (!rootResult.html && rootResult.status < 400)) {
    throw new Error(`Could not fetch ${baseUrl}. Site may be unreachable.`);
  }

  const pages: PageData[] = [];
  const visited = new Set<string>();

  const $ = cheerio.load(rootResult.html);
  const title = $("title").first().text().trim() || baseUrl;
  pages.push({
    url: baseUrl,
    path: parsedBase.pathname,
    html: rootResult.html,
    title,
    statusCode: rootResult.status,
  });
  visited.add(baseUrl);

  const discoveredLinks = extractInternalLinks($, baseUrl);
  const toVisit = discoveredLinks
    .filter((l) => !visited.has(l))
    .slice(0, maxPages);

  const CONCURRENCY = 5;
  for (let i = 0; i < toVisit.length; i += CONCURRENCY) {
    const batch = toVisit.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (url) => {
        if (visited.has(url)) return null;
        visited.add(url);
        const result = await fetchPage(url);
        if (!result || (!result.html && result.status < 400)) return null;

        const $page = cheerio.load(result.html);
        const pageTitle = $page("title").first().text().trim() || url;
        const path = new URL(url).pathname;

        return {
          url,
          path,
          html: result.html,
          title: pageTitle,
          statusCode: result.status,
        } as PageData;
      }),
    );

    for (const r of results) {
      if (r) pages.push(r);
    }

    if (i + CONCURRENCY < toVisit.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const [robotsTxt, sitemapXml, llmsTxt, llmsFullTxt] = await Promise.all([
    fetchTextFile(`${origin}/robots.txt`),
    fetchTextFile(`${origin}/sitemap.xml`),
    fetchTextFile(`${origin}/llms.txt`),
    fetchTextFile(`${origin}/llms-full.txt`),
  ]);

  const siteType = detectSiteType(pages);

  return {
    pages,
    robotsTxt,
    sitemapXml,
    llmsTxt,
    llmsFullTxt,
    siteType,
    baseUrl: origin,
  };
}
