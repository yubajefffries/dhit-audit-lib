import dns from "dns/promises";
import type { EmailSecurityResult, SpfResult, DmarcResult, DkimResult } from "../types";

const DKIM_SELECTORS = [
  "google",
  "default",
  "selector1",
  "selector2",
  "k1",
  "dkim",
  "mail",
  "s1",
  "s2",
];

async function resolveTxt(hostname: string, timeoutMs = 3000): Promise<string[]> {
  try {
    const records = await Promise.race([
      dns.resolveTxt(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dns-timeout")), timeoutMs),
      ),
    ]);
    return records.map((r) => r.join(""));
  } catch {
    return [];
  }
}

async function checkSpf(domain: string): Promise<SpfResult> {
  const records = await resolveTxt(domain);
  const spfRecord = records.find((r) => r.startsWith("v=spf1"));

  if (!spfRecord) {
    return {
      found: false,
      record: null,
      mechanism: null,
      grade: "fail",
      detail: "No SPF record found, anyone can send email as your domain",
    };
  }

  const lower = spfRecord.toLowerCase();
  let mechanism: string | null = null;
  let grade: "pass" | "warning" | "fail" = "warning";
  let detail: string;

  if (lower.includes("-all")) {
    mechanism = "-all";
    grade = "pass";
    detail = "SPF -all observed: requests a hard-fail result for unmatched senders. Receiver handling and full SPF evaluation were not tested.";
  } else if (lower.includes("~all")) {
    mechanism = "~all";
    grade = "warning";
    detail =
      "SPF ~all observed: requests a soft-fail result for unmatched senders. Receiver handling was not tested.";
  } else if (lower.includes("+all") || lower.includes("?all")) {
    mechanism = lower.includes("+all") ? "+all" : "?all";
    grade = "fail";
    detail =
      "Permissive policy, allows anyone to send as your domain. This is a security risk";
  } else {
    mechanism = null;
    grade = "warning";
    detail = "SPF record exists but has no explicit all mechanism";
  }

  return { found: true, record: spfRecord, mechanism, grade, detail };
}

async function checkDmarc(domain: string): Promise<DmarcResult> {
  const records = await resolveTxt(`_dmarc.${domain}`);
  const dmarcRecord = records.find((r) => r.startsWith("v=DMARC1"));

  if (!dmarcRecord) {
    return {
      found: false,
      record: null,
      policy: null,
      subdomainPolicy: null,
      dkimAlignment: null,
      spfAlignment: null,
      reportingConfigured: false,
      strict: false,
      grade: "fail",
      findings: [
        "No DMARC record observed. DNS lookup failures can resemble missing records; message handling was not tested.",
      ],
    };
  }

  const tags = new Map<string, string>();
  dmarcRecord.split(";").forEach((part) => {
    const [key, ...vals] = part.trim().split("=");
    if (key && vals.length > 0) {
      tags.set(key.trim().toLowerCase(), vals.join("=").trim().toLowerCase());
    }
  });

  const policy = tags.get("p") || null;
  const subdomainPolicy = tags.get("sp") || null;
  const dkimAlignment = tags.get("adkim") || null;
  const spfAlignment = tags.get("aspf") || null;
  const rua = tags.get("rua") || null;
  const pct = tags.get("pct");

  const findings: string[] = [];
  let grade: "pass" | "warning" | "fail" = "pass";

  if (policy === "reject") {
    findings.push("Policy: reject observed; requests rejection of DMARC failures. Receiver enforcement was not tested.");
  } else if (policy === "quarantine") {
    findings.push(
      "Policy: quarantine observed; requests quarantine for DMARC failures. Receiver enforcement was not tested.",
    );
    grade = "warning";
  } else {
    findings.push(
      "Policy: none, no enforcement. Spoofed emails are delivered normally",
    );
    grade = "fail";
  }

  if (subdomainPolicy === "reject") {
    findings.push("Subdomain policy: reject, strict");
  } else if (subdomainPolicy === "quarantine") {
    findings.push("Subdomain policy: quarantine");
  } else if (!subdomainPolicy || subdomainPolicy === "none") {
    findings.push("Subdomain policy: not set or none; an omitted sp policy inherits p. Receiver enforcement was not tested.");
    if (grade === "pass") grade = "warning";
  }

  if (dkimAlignment === "s") {
    findings.push("DKIM alignment: strict");
  } else {
    findings.push(
      "DKIM alignment: relaxed (default). Strict (adkim=s) recommended",
    );
    if (grade === "pass") grade = "warning";
  }

  if (spfAlignment === "s") {
    findings.push("SPF alignment: strict");
  } else {
    findings.push(
      "SPF alignment: relaxed (default). Strict (aspf=s) recommended",
    );
    if (grade === "pass") grade = "warning";
  }

  const reportingConfigured = !!rua;
  if (reportingConfigured) {
    findings.push("Aggregate reporting (rua): configured");
  } else {
    findings.push(
      "Aggregate reporting (rua): not configured, you won't see abuse reports",
    );
    if (grade === "pass") grade = "warning";
  }

  if (pct && pct !== "100") {
    findings.push(
      `Enforcement percentage: ${pct}%, not fully enforced. Set pct=100 for full coverage`,
    );
    if (grade === "pass") grade = "warning";
  }

  const strict =
    policy === "reject" && dkimAlignment === "s" && spfAlignment === "s";

  return {
    found: true,
    record: dmarcRecord,
    policy,
    subdomainPolicy,
    dkimAlignment,
    spfAlignment,
    reportingConfigured,
    strict,
    grade,
    findings,
  };
}

async function checkDkim(domain: string): Promise<DkimResult> {
  const results = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const hostname = `${selector}._domainkey.${domain}`;
      const records = await resolveTxt(hostname);
      const dkimRecord = records.find((r) => r.includes("v=DKIM1"));
      return dkimRecord ? selector : null;
    }),
  );

  const matched = results.find((s): s is string => s !== null);
  if (matched) {
    return {
      found: true,
      selector: matched,
      grade: "pass",
      detail: `DKIM record found with selector "${matched}"`,
    };
  }

  return {
    found: false,
    selector: null,
    grade: "info",
    detail:
      "No DKIM record found for common selectors. DKIM may exist with a custom selector",
  };
}

export async function checkEmailSecurity(
  domain: string,
): Promise<EmailSecurityResult> {
  const [spf, dmarc, dkim] = await Promise.all([
    checkSpf(domain),
    checkDmarc(domain),
    checkDkim(domain),
  ]);

  let overallGrade: "pass" | "warning" | "fail" = "pass";
  if (spf.grade === "fail" || dmarc.grade === "fail") {
    overallGrade = "fail";
  } else if (
    spf.grade === "warning" ||
    dmarc.grade === "warning" ||
    dkim.grade === "info"
  ) {
    overallGrade = "warning";
  }

  return { spf, dmarc, dkim, overallGrade };
}
