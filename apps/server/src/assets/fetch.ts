import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { HttpError } from "../http-errors";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped?.[1]) return blocked.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

export interface FetchOptions {
  allowPrivate: boolean;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Whole request, including a slow body. */
  totalTimeoutMs?: number;
}

/**
 * Downloads a URL for the asset pool. The address is checked at connect time
 * (custom DNS lookup), so DNS rebinding cannot slip a private address in.
 * Redirects are followed manually, each hop checked again.
 */
export async function fetchPublicUrl(rawUrl: string, options: FetchOptions): Promise<{ body: Buffer; contentType: string | null; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(422, "bad_url", "Неверная ссылка");
  }
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(422, "bad_url", "Нужна ссылка http или https");
    if (url.username || url.password) throw new HttpError(422, "bad_url", "Ссылка с логином и паролем не принимается");
    // IP literals skip DNS lookup entirely, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host) && !options.allowPrivate) {
      throw new HttpError(422, "private_address", "Ссылка ведёт на приватный адрес");
    }
    const res = await request(url, options);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = new URL(res.location, url);
      continue;
    }
    if (res.status !== 200) throw new HttpError(422, "fetch_failed", `Сервер ответил ${res.status}`);
    return { body: res.body, contentType: res.contentType, finalUrl: url.toString() };
  }
  throw new HttpError(422, "too_many_redirects", "Слишком много перенаправлений");
}

function request(url: URL, options: FetchOptions): Promise<{ status: number; location: string | null; contentType: string | null; body: Buffer }> {
  const guardedLookup: LookupFunction = (hostname, opts, callback) => {
    dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = addresses as unknown as { address: string; family: number }[];
      const bad = list.find((a) => isPrivateAddress(a.address));
      if (bad && !options.allowPrivate) {
        return callback(new HttpError(422, "private_address", "Ссылка ведёт на приватный адрес"), "", 4);
      }
      const first = list[0];
      if (!first) return callback(new Error("no address"), "", 4);
      if ((opts as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
      return callback(null, first.address, first.family);
    });
  };
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    // the socket timeout only catches silence; a server dripping bytes needs a total deadline
    const deadline = setTimeout(() => req.destroy(new HttpError(422, "timeout", "Ссылка отвечает слишком долго")), options.totalTimeoutMs ?? 20_000);
    const done = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(deadline);
      fn(v);
    };
    resolve = done(resolve);
    reject = done(reject);
    const req = lib.get(
      url,
      { lookup: guardedLookup, timeout: options.timeoutMs ?? 10_000, headers: { "user-agent": "Asobiba/0.1 (+asset import)", accept: "image/*" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location ?? null, contentType: null, body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          res.destroy();
          return reject(new HttpError(413, "too_big", "Картинка по ссылке слишком большая"));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            res.destroy();
            reject(new HttpError(413, "too_big", "Картинка по ссылке слишком большая"));
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, location: null, contentType: res.headers["content-type"] ?? null, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new HttpError(422, "timeout", "Ссылка не ответила вовремя")));
    req.on("error", (e) => reject(e instanceof HttpError ? e : new HttpError(422, "fetch_failed", `Не удалось скачать: ${e.message}`)));
  });
}
