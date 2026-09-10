import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
// Azure's platform virtual IP is globally numbered but is not a public website.
blocked.addAddress("168.63.129.16", "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6");

/** Fail closed, including mapped IPv4, translation/tunnel, and scoped addresses. */
export function isPublicAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

type Address = { address: string; family: number };
export type Resolver = (hostname: string) => Promise<Address[]>;
const resolveAll: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

export async function resolveDestination(url: URL, resolve: Resolver = resolveAll): Promise<Address> {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Unsupported crawl URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname || /(^|\.)localhost$/i.test(hostname)) throw new Error("Blocked crawl host");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await resolve(hostname);
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address) || isIP(a.address) !== a.family)) {
    throw new Error("Crawl destination is not exclusively public");
  }
  return addresses[0];
}

/** Pin the TCP destination. Preserve the original Host header and TLS identity. */
function requestOnce(url: URL, destination: Address, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      agent: false,
      signal,
      family: destination.family,
      lookup: (_hostname, _options, callback) => callback(null, destination.address, destination.family),
      headers: {
        "User-Agent": "LLMSearch-Audit/1.0 (+https://yourupdatedpage.xyz)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "identity",
      },
      maxHeaderSize: 16 * 1024,
    }, resolve);
    req.on("error", reject);
    req.end();
  });
}

// Internal dependency seam for offline transport tests; crawlSite never accepts overrides.
export interface FetchDependencies {
  resolve?: Resolver;
  request?: typeof requestOnce;
}

export async function fetchBounded(
  input: string,
  options: { maxBytes: number; timeoutMs: number; htmlOnly?: boolean },
  dependencies: FetchDependencies = {},
): Promise<{ body: string; status: number; url: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Crawl request timed out")), options.timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  void aborted.catch(() => {});
  let response: IncomingMessage | undefined;
  try {
    let url = new URL(input);
    for (let hop = 0; ; hop++) {
      const destination = await Promise.race([resolveDestination(url, dependencies.resolve), aborted]);
      controller.signal.throwIfAborted();
      response = await Promise.race([(dependencies.request ?? requestOnce)(url, destination, controller.signal), aborted]);
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || hop >= MAX_REDIRECTS) throw new Error("Invalid or excessive crawl redirects");
        url = new URL(location, url);
        continue;
      }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding.toLowerCase() !== "identity") throw new Error("Unsupported crawl content encoding");
      const length = response.headers["content-length"];
      if (length && (!/^\d+$/.test(length) || Number(length) > options.maxBytes)) throw new Error("Crawl body exceeds byte limit");
      const contentType = response.headers["content-type"]?.toLowerCase() ?? "";
      // Preserve error status even for non-HTML error bodies, without parsing those bodies.
      if (options.htmlOnly && !/text\/html|application\/xhtml\+xml/.test(contentType)) {
        if (status >= 400) return { body: "", status, url: url.href };
        throw new Error("Crawl response is not HTML");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const readBody = async () => {
        for await (const chunk of response!) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > options.maxBytes) throw new Error("Crawl body exceeds byte limit");
          chunks.push(bytes);
        }
        return Buffer.concat(chunks).toString("utf8");
      };
      const body = await Promise.race([readBody(), aborted]);
      return { body, status, url: url.href };
    }
  } finally {
    clearTimeout(timeout);
    response?.destroy();
    controller.abort();
  }
}
