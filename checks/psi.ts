/**
 * PageSpeed Insights (PSI) API client.
 *
 * Calls Google's free PSI API to retrieve real Core Web Vitals for a URL.
 * The API returns:
 *   - Lighthouse lab data (always)
 *   - CrUX field data (when enough real-user data exists for the origin)
 *
 * Auth: PSI_API_KEY env var is OPTIONAL. Without it you get the public quota
 * (heavily rate-limited). With a key (free from Google Cloud Console / PSI
 * docs) the quota is 25,000 requests/day per project — way more than we'll
 * use. The key lives in Bitwarden Secrets Manager and syncs to Vercel env.
 *
 * Source: https://developers.google.com/speed/docs/insights/v5/get-started
 */

export interface CwvMetric {
  /** Raw numeric value, in ms for LCP/INP/TTFB, unitless for CLS, 0-1 for performance score. */
  value: number;
  unit: "ms" | "s" | "unitless" | "score";
  /** Google's category bands. */
  category: "good" | "needs-improvement" | "poor";
}

export interface PsiResult {
  url: string;
  strategy: "mobile" | "desktop";
  /** Lighthouse lab performance score, 0-100. */
  performanceScore: number;
  lcp: CwvMetric;
  inp?: CwvMetric;
  cls: CwvMetric;
  ttfb?: CwvMetric;
  /** CrUX field data — only present when the origin has enough real-user samples. */
  fieldData?: {
    lcp?: CwvMetric;
    inp?: CwvMetric;
    cls?: CwvMetric;
    ttfb?: CwvMetric;
  };
  /** Whether the response included field data (real-user) — a quality signal. */
  hasFieldData: boolean;
}

interface PsiOptions {
  strategy?: "mobile" | "desktop";
  /** Abort the request after this many ms. Default 45000 (PSI normally finishes in 20-40s). */
  timeoutMs?: number;
}

function categorize(metric: "lcp" | "inp" | "cls" | "ttfb", value: number): CwvMetric["category"] {
  // Google's official Core Web Vitals thresholds.
  // https://web.dev/articles/vitals
  switch (metric) {
    case "lcp":
      // milliseconds
      if (value <= 2500) return "good";
      if (value <= 4000) return "needs-improvement";
      return "poor";
    case "inp":
      if (value <= 200) return "good";
      if (value <= 500) return "needs-improvement";
      return "poor";
    case "cls":
      if (value <= 0.1) return "good";
      if (value <= 0.25) return "needs-improvement";
      return "poor";
    case "ttfb":
      if (value <= 800) return "good";
      if (value <= 1800) return "needs-improvement";
      return "poor";
  }
}

function extractLabMetric(audits: Record<string, { numericValue?: number }> | undefined, key: string): number | undefined {
  const audit = audits?.[key];
  if (!audit || typeof audit.numericValue !== "number") return undefined;
  return audit.numericValue;
}

function extractFieldMetric(
  metrics: Record<string, { percentile?: number; category?: string }> | undefined,
  key: string,
): { value: number; category: CwvMetric["category"] } | undefined {
  const m = metrics?.[key];
  if (!m || typeof m.percentile !== "number") return undefined;
  // PSI returns "FAST" | "AVERAGE" | "SLOW" — normalize.
  const cat = (m.category ?? "").toUpperCase();
  const category: CwvMetric["category"] =
    cat === "FAST" ? "good" : cat === "AVERAGE" ? "needs-improvement" : "poor";
  return { value: m.percentile, category };
}

export async function fetchPsi(
  url: string,
  opts: PsiOptions = {},
): Promise<PsiResult | null> {
  const strategy = opts.strategy ?? "mobile";
  const timeoutMs = opts.timeoutMs ?? 45000;
  const apiKey = process.env.PSI_API_KEY;

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.append("category", "performance");
  if (apiKey) endpoint.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      // Log to stderr so the cause is visible in server logs but not the UI.
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(
          `[psi] HTTP ${response.status} ${response.statusText} for ${url}: ${bodyText.slice(0, 200)}\n`,
        );
      }
      return null;
    }
    const data = await response.json();
    return parsePsiResponse(url, strategy, data);
  } catch (err) {
    if (typeof process !== "undefined" && process.stderr) {
      process.stderr.write(
        `[psi] fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parsePsiResponse(
  url: string,
  strategy: "mobile" | "desktop",
  data: unknown,
): PsiResult | null {
  if (!data || typeof data !== "object") return null;
  const root = data as {
    lighthouseResult?: {
      categories?: { performance?: { score?: number } };
      audits?: Record<string, { numericValue?: number }>;
    };
    loadingExperience?: {
      metrics?: Record<string, { percentile?: number; category?: string }>;
    };
  };

  const audits = root.lighthouseResult?.audits;
  if (!audits) return null;

  const perfScore = root.lighthouseResult?.categories?.performance?.score;
  const performanceScore = typeof perfScore === "number" ? Math.round(perfScore * 100) : 0;

  const lcpMs = extractLabMetric(audits, "largest-contentful-paint");
  const clsValue = extractLabMetric(audits, "cumulative-layout-shift");
  const inpMs = extractLabMetric(audits, "interaction-to-next-paint") ??
    extractLabMetric(audits, "experimental-interaction-to-next-paint");
  const ttfbMs = extractLabMetric(audits, "server-response-time");

  if (lcpMs === undefined || clsValue === undefined) {
    // Without at least LCP and CLS we don't have enough to be useful.
    return null;
  }

  const fieldMetrics = root.loadingExperience?.metrics;
  const fieldLcp = extractFieldMetric(fieldMetrics, "LARGEST_CONTENTFUL_PAINT_MS");
  const fieldInp = extractFieldMetric(fieldMetrics, "INTERACTION_TO_NEXT_PAINT");
  const fieldCls = extractFieldMetric(fieldMetrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE");
  const fieldTtfb = extractFieldMetric(fieldMetrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE");
  const hasFieldData = !!(fieldLcp || fieldInp || fieldCls);

  return {
    url,
    strategy,
    performanceScore,
    lcp: { value: lcpMs, unit: "ms", category: categorize("lcp", lcpMs) },
    cls: { value: clsValue, unit: "unitless", category: categorize("cls", clsValue) },
    inp:
      inpMs !== undefined
        ? { value: inpMs, unit: "ms", category: categorize("inp", inpMs) }
        : undefined,
    ttfb:
      ttfbMs !== undefined
        ? { value: ttfbMs, unit: "ms", category: categorize("ttfb", ttfbMs) }
        : undefined,
    fieldData: hasFieldData
      ? {
          lcp: fieldLcp
            ? { value: fieldLcp.value, unit: "ms", category: fieldLcp.category }
            : undefined,
          inp: fieldInp
            ? { value: fieldInp.value, unit: "ms", category: fieldInp.category }
            : undefined,
          cls: fieldCls
            ? {
                // CrUX returns CLS percentile * 100 (so 100 = 0.1); normalize.
                value: fieldCls.value / 100,
                unit: "unitless",
                category: fieldCls.category,
              }
            : undefined,
          ttfb: fieldTtfb
            ? { value: fieldTtfb.value, unit: "ms", category: fieldTtfb.category }
            : undefined,
        }
      : undefined,
    hasFieldData,
  };
}
