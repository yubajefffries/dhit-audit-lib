import type { DimensionResult, Finding } from "../types";

/**
 * llms.txt detection — INFORMATIONAL ONLY (does not affect the score).
 *
 * Per Google's AI Optimization Guide (https://developers.google.com/search/docs/fundamentals/ai-optimization-guide):
 *   "You don't need to create new machine readable files, AI text files,
 *    markup, or Markdown to appear in generative AI search."
 *
 * We still detect llms.txt if present so users with one can see it was found,
 * but we no longer score it. Sites without llms.txt are not penalized.
 */
export function checkLlmsTxt(
  llmsTxt: string | null,
  llmsFullTxt: string | null,
): DimensionResult {
  const findings: Finding[] = [];

  findings.push({
    type: "info",
    message:
      "Google says you do not need llms.txt for AI search visibility.",
    detail:
      "Per the Google AI Optimization Guide: \"You don't need to create new machine readable files, AI text files, markup, or Markdown to appear in generative AI search.\" This check is shown for completeness only and does not affect your score.",
  });

  if (llmsTxt) {
    findings.push({
      type: "info",
      message: "Detected: llms.txt present at site root.",
    });
    if (llmsFullTxt) {
      findings.push({
        type: "info",
        message: "Detected: llms-full.txt present at site root.",
      });
    }
  } else {
    findings.push({
      type: "info",
      message: "Not present: no llms.txt at the site root.",
      detail:
        "This is not a problem. Google's AI surfaces retrieve from the regular Search index — no special files are required.",
    });
  }

  return {
    id: "llmsTxt",
    name: "llms.txt (Informational)",
    weight: 0,
    score: 0,
    grade: "—",
    findings,
    fixable: false,
    informational: true,
    googleQuote:
      "You don't need to create new machine readable files, AI text files, markup, or Markdown to appear in generative AI search.",
    googleSource:
      "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide",
  };
}
