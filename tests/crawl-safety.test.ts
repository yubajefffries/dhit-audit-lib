import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import http, { type IncomingMessage } from "node:http";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { fetchBounded, isPublicAddress, resolveDestination, type FetchDependencies } from "../safe-fetch";
import { crawlSite } from "../crawler";
import { checkIndexability } from "../checks/indexability";

const publicIp = { address: "93.184.216.34", family: 4 };
const resolve = async () => [publicIp];
const options = { maxBytes: 32, timeoutMs: 1000, htmlOnly: true };
function response(body: string | null = "<html>ok</html>", status = 200, headers = {}): IncomingMessage & PassThrough {
  const stream = new PassThrough();
  Object.assign(stream, { statusCode: status, headers: { "content-type": "text/html", ...headers } });
  if (body !== null) stream.end(body);
  return stream as unknown as IncomingMessage & PassThrough;
}

test("blocks private, special-use, metadata, mapped and tunnel addresses", async () => {
  for (const ip of ["0.0.0.0", "127.0.0.1", "10.1.2.3", "172.31.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "168.63.129.16", "198.18.0.1", "192.0.2.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "fe80::1%eth0", "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "2001::1", "3fff::1", "bad"]) assert(!isPublicAddress(ip), ip);
  for (const ip of [publicIp.address, "8.8.8.8", "2606:4700:4700::1111"]) assert(isPublicAddress(ip), ip);
  for (const url of ["http://127.1", "http://0x7f000001", "http://2130706433", "http://[::ffff:127.0.0.1]", "http://localhost.", "ftp://example.test", "http://user:password@example.test"]) await assert.rejects(resolveDestination(new URL(url), resolve), url);
  await assert.rejects(resolveDestination(new URL("http://example.test"), async () => [publicIp, { address: "10.0.0.1", family: 4 }]));
  await assert.rejects(resolveDestination(new URL("http://example.test"), async () => []));
  await assert.rejects(resolveDestination(new URL("http://example.test"), async () => { throw Error("DNS failed"); }));
});

test("checks each redirect, blocks mixed DNS and limits redirect loops", async () => {
  let calls = 0;
  const request: FetchDependencies["request"] = async (_url, address) => {
    calls++;
    assert.deepEqual(address, publicIp);
    return response("", 302, { location: "http://169.254.169.254/latest/meta-data" });
  };
  await assert.rejects(fetchBounded("http://example.test", options, { resolve, request }));
  assert.equal(calls, 1);
  calls = 0;
  const loop: FetchDependencies["request"] = async () => { calls++; return response("", 302, { location: "/again" }); };
  await assert.rejects(fetchBounded("http://example.test", options, { resolve, request: loop }), /redirects/);
  assert.equal(calls, 6);
  let lookups = 0;
  await assert.rejects(fetchBounded("http://example.test", options, {
    resolve: async () => ++lookups === 1 ? [publicIp] : [{ address: "127.0.0.1", family: 4 }], request: loop,
  }));
  assert.equal(lookups, 2);
});

test("accepts bounded HTML and preserves empty/non-HTML HTTP errors", async () => {
  const result = await fetchBounded("http://example.test", options, { resolve, request: async () => response() });
  assert.equal(result.body, "<html>ok</html>");
  const error = await fetchBounded("http://example.test", options, { resolve, request: async () => response("", 503, { "content-type": "text/plain" }) });
  assert.equal(error.status, 503);
  assert.equal(error.body, "");
});

test("bounds declared, chunked, multibyte bodies and rejects compression", async () => {
  for (const stream of [response("small", 200, { "content-length": "33" }), response("x".repeat(33)), response("é".repeat(17)), response("compressed", 200, { "content-encoding": "gzip" })]) {
    await assert.rejects(fetchBounded("http://example.test", options, { resolve, request: async () => stream }));
    assert(stream.destroyed);
  }
  const stream = response(null);
  setTimeout(() => { stream.write("x".repeat(20)); stream.end("x".repeat(20)); }, 5);
  await assert.rejects(fetchBounded("http://example.test", options, { resolve, request: async () => stream }), /byte limit/);
  assert(stream.destroyed);
});

test("deadline covers stalled DNS and body reads; destroys stream", async () => {
  await assert.rejects(fetchBounded("http://example.test", { ...options, timeoutMs: 20 }, { resolve: () => new Promise(() => {}) }), /timed out/);
  const stream = response(null);
  await assert.rejects(fetchBounded("http://example.test", { ...options, timeoutMs: 20 }, { resolve, request: async () => stream }), /timed out/);
  assert(stream.destroyed);
  await assert.rejects(fetchBounded("not a URL", options));
});

test("crawler uses pinned lookup and retains HTTP-error pages for indexability", async () => {
  const originalLookup = dns.lookup;
  const originalRequest = http.request;
  let requests = 0;
  // Replace only the operating-system boundaries; crawler and transport run normally.
  dns.lookup = (async () => [publicIp]) as unknown as typeof dns.lookup;
  http.request = ((url: URL, opts: http.RequestOptions, callback: (r: IncomingMessage) => void) => {
    requests++;
    assert.equal(opts.agent, false);
    assert.equal(opts.family, 4);
    assert.equal(url.hostname, "example.test");
    (opts.lookup as (host: string, options: object, callback: (error: Error | null, address: string) => void) => void)("example.test", {}, (err: Error | null, address: string) => {
      assert.equal(err, null); assert.equal(address, publicIp.address);
    });
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => queueMicrotask(() => callback(url.pathname === "/" ? response('<html><a href="/missing">Missing</a></html>') : response("", 404)));
    return req;
  }) as typeof http.request;
  syncBuiltinESMExports();
  try {
    const crawl = await crawlSite("http://example.test");
    assert.equal(crawl.pages.length, 2);
    assert.equal(crawl.pages[1].statusCode, 404);
    assert(checkIndexability(crawl.pages).pages?.[1].findings.some((f) => f.type === "fail" && /404/.test(f.message)));
    assert.equal(requests, 6);
    const rootError = await crawlSite("http://example.test/missing");
    assert.equal(rootError.pages[0].statusCode, 404);
    assert.equal(rootError.pages[0].path, "/missing");
  } finally {
    dns.lookup = originalLookup;
    http.request = originalRequest;
    syncBuiltinESMExports();
  }
});
