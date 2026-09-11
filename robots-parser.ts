export interface RobotsRule {
  userAgent: string;
  rules: { type: "allow" | "disallow"; path: string }[];
}

/** Common robots group semantics: adjacent agents share directives; repeated
 * groups merge. Comments and empty Disallow directives are handled explicitly. */
export function parseRobotsTxt(content: string): RobotsRule[] {
  const groups: RobotsRule[] = [];
  let agents: string[] = [];
  let rules: RobotsRule["rules"] = [];
  let directives = false;
  const flush = () => {
    for (const userAgent of agents) groups.push({ userAgent, rules });
    agents = []; rules = []; directives = false;
  };
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.split("#", 1)[0].trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "user-agent") {
      if (directives) flush();
      if (value) agents.push(value.toLowerCase());
    } else if (agents.length && (name === "allow" || name === "disallow")) {
      directives = true;
      if (value.startsWith("/")) rules.push({ type: name, path: value });
    }
  }
  flush();
  return groups;
}

// Decode percent-encoded unreserved ASCII; retain encoded reserved characters.
function normalizePath(path: string): string {
  return Array.from(path).map((c) => c.charCodeAt(0) > 127 ? encodeURIComponent(c) : c).join("")
    .replace(/%[0-9a-f]{2}/gi, (value) => {
      const char = String.fromCharCode(parseInt(value.slice(1), 16));
      return /[a-z0-9._~-]/i.test(char) ? char : value.toUpperCase();
    });
}

// Greedy wildcard matcher avoids compiling untrusted rules into regexes.
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  pattern = anchored ? pattern.slice(0, -1) : pattern + "*";
  let p = 0, s = 0, star = -1, retry = 0;
  while (s < path.length) {
    if (pattern[p] === "*") { star = p++; retry = s; }
    else if (pattern[p] === path[s]) { p++; s++; }
    else if (star >= 0) { p = star + 1; s = ++retry; }
    else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}

export function isCrawlerBlocked(groups: RobotsRule[], crawler: string, path = "/"): boolean {
  const name = crawler.toLowerCase();
  const specific = groups.filter((g) => g.userAgent !== "*" && name.includes(g.userAgent));
  const longest = Math.max(0, ...specific.map((g) => g.userAgent.length));
  const selected = longest ? specific.filter((g) => g.userAgent.length === longest) : groups.filter((g) => g.userAgent === "*");
  const target = normalizePath(path);
  let best = -1;
  let blocked = false;
  for (const group of selected) for (const rule of group.rules) {
    const pattern = normalizePath(rule.path);
    if (!matches(pattern, target)) continue;
    const length = new TextEncoder().encode(pattern.replace(/\*/g, "").replace(/\$$/, "")).length;
    if (length > best || (length === best && rule.type === "allow")) {
      best = length; blocked = rule.type === "disallow";
    }
  }
  return blocked;
}
