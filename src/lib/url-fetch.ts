import "server-only";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createGunzip } from "node:zlib";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

/** A problem with the link, with a message that's safe to show the user. */
export class UrlError extends Error {}

const PRIVATE_NETWORKS = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, "ipv6");
}

const isPublic = (address: string) => !PRIVATE_NETWORKS.check(address, net.isIPv6(address) ? "ipv6" : "ipv4");
const PRIVATE_MESSAGE = "Only public websites can be saved, not addresses on your computer or network.";

/**
 * Runs when the connection opens, so a site can't pass a check and then point
 * its name at a private address.
 */
const publicLookup = ((hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (addresses.some((a) => !isPublic(a.address))) return callback(new UrlError(PRIVATE_MESSAGE), "", 0);
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}) as net.LookupFunction;

/** Accepts "example.com" as well as a full link, and rejects anything that isn't public http(s). */
function parseUrl(raw: string): URL {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new UrlError("That doesn't look like a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlError("Only http and https links can be saved.");
  if (url.username || url.password) throw new UrlError("Links with a username or password can't be saved.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublic(host)) throw new UrlError(PRIVATE_MESSAGE);
  return url;
}

function get(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      {
        lookup: publicLookup,
        signal,
        headers: {
          "User-Agent": "Contexta/0.0.1",
          Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Encoding": "gzip",
        },
      },
      resolve,
    );
    request.on("error", reject);
  });
}

async function readBody(response: http.IncomingMessage): Promise<Uint8Array> {
  const stream = response.headers["content-encoding"] === "gzip" ? response.pipe(createGunzip()) : response;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      response.destroy();
      throw new UrlError("That page is larger than 20 MB.");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function friendlyError(err: unknown): Error {
  if (err instanceof UrlError) return err;
  const { code, name } = err as NodeJS.ErrnoException;
  if (name === "AbortError" || name === "TimeoutError") return new UrlError("That site took too long to respond.");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new UrlError("Couldn't find that site. Check the link.");
  if (code === "Z_DATA_ERROR") return new UrlError("That site sent a damaged response.");
  return new UrlError("Couldn't connect to that site.");
}

/** Downloads a public link, following redirects and checking every address along the way. */
export async function fetchUrl(raw: string): Promise<{ url: string; contentType: string; bytes: Uint8Array }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = parseUrl(raw);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await get(url, signal);
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        url = parseUrl(new URL(location, url).href);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        if (status === 401 || status === 403) throw new UrlError("That site refused the request. The page may need a login.");
        if (status === 404 || status === 410) throw new UrlError("That page doesn't exist.");
        throw new UrlError(`That site returned an error (${status}).`);
      }
      return { url: url.href, contentType: response.headers["content-type"] ?? "", bytes: await readBody(response) };
    }
  } catch (err) {
    throw friendlyError(err);
  }
  throw new UrlError("That link redirects too many times.");
}
