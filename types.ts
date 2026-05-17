export interface Finding {
  type: "pass" | "warning" | "fail" | "info";
  message: string;
  detail?: string;
  page?: string;
}

export interface PerPageScore {
  url: string;
  path: string;
  title: string;
  score: number;
  findings: Finding[];
}

export interface DimensionResult {
  id: string;
  name: string;
  weight: number;
  score: number;
  grade: string;
  findings: Finding[];
  fixable: boolean;
  /**
   * When true, this dimension is surfaced for transparency but does NOT
   * contribute to the overall score. Used for things Google explicitly says
   * are not required for AI search visibility (llms.txt, third-party AI
   * crawler allow-lists, etc.).
   */
  informational?: boolean;
  /** Optional quote from Google for informational dimensions. */
  googleQuote?: string;
  /** Optional source URL for informational dimensions. */
  googleSource?: string;
  /** Populated for per-page dimensions when running a deep audit. */
  pages?: PerPageScore[];
}

export interface PageData {
  url: string;
  path: string;
  html: string;
  title: string;
  statusCode?: number;
}

export interface SpfResult {
  found: boolean;
  record: string | null;
  mechanism: string | null;
  grade: "pass" | "warning" | "fail";
  detail: string;
}

export interface DmarcResult {
  found: boolean;
  record: string | null;
  policy: string | null;
  subdomainPolicy: string | null;
  dkimAlignment: string | null;
  spfAlignment: string | null;
  reportingConfigured: boolean;
  strict: boolean;
  grade: "pass" | "warning" | "fail";
  findings: string[];
}

export interface DkimResult {
  found: boolean;
  selector: string | null;
  grade: "pass" | "warning" | "info";
  detail: string;
}

export interface EmailSecurityResult {
  spf: SpfResult;
  dmarc: DmarcResult;
  dkim: DkimResult;
  overallGrade: "pass" | "warning" | "fail";
}

export interface PageAuditSummary {
  url: string;
  path: string;
  title: string;
  overallScore: number;
  grade: string;
}

export interface AuditResult {
  url: string;
  timestamp: string;
  siteType: string;
  pagesAudited: number;
  overallScore: number;
  grade: string;
  /** Scored dimensions — contribute to overallScore. */
  dimensions: DimensionResult[];
  /**
   * Informational dimensions — surfaced in the report but do not contribute
   * to the score. Things Google says are not required for AI search.
   */
  informational?: DimensionResult[];
  /** Engine version used to score this audit (e.g. "2.0.0-google-aligned"). */
  engineVersion?: string;
  priorities: string[];
  emailSecurity?: EmailSecurityResult;
  /** Per-page overall scores. Populated by runDeepAudit. */
  pageScores?: PageAuditSummary[];
}

export interface CrawlResult {
  pages: PageData[];
  robotsTxt: string | null;
  sitemapXml: string | null;
  llmsTxt: string | null;
  llmsFullTxt: string | null;
  siteType: string;
  baseUrl: string;
}
