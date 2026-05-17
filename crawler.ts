import * as cheerio from "cheerio";
import type { CrawlResult, PageData } from "./types";
import { extractInternalLinks, detectSiteType } from "./parsers";
import { MAX_PAGES_TO_DISCOVER } from "./constants";

const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^\[::1\]$/,
  /^\[fc/i,
  /^\[fd/i,
  /^\[fe80/i,
];

function isBlockedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return BLOCKED_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return true;
  }
}

async function fetchPage(
  url: string,
): Promise<{ html: string; status: number } | null> {
  if (isBlockedUrl(url)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "LLMSearch-Audit/1.0 (+https://yourupdatedpage.xyz)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return { html: "", status: response.status };

    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      return null;
    }

    const html = await response.text();
    return { html, status: response.status };
  } catch {
    return null;
  }
}

async function fetchTextFile(url: string): Promise<string | null> {
  if (isBlockedUrl(url)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "LLMSearch-Audit/1.0 (+https://yourupdatedpage.xyz)",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    return await response.text();
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
  if (!rootResult || !rootResult.html) {
    throw new Error(`Could not fetch ${baseUrl}. Site may be unreachable.`);
  }

  const pages: PageData[] = [];
  const visited = new Set<string>();

  const $ = cheerio.load(rootResult.html);
  const title = $("title").first().text().trim() || baseUrl;
  pages.push({
    url: baseUrl,
    path: "/",
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
        if (!result || !result.html) return null;

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
