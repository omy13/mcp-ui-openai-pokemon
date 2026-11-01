import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Webhook } from "standardwebhooks";

export const MAX_BODY_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;

// Rangos que nunca deben recibir un callback (SSRF): privados, loopback, link-local, etc.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

function isPublicAddress(address: string): boolean {
  // IPv4 dentro de IPv6 (::ffff:10.0.0.1): se valida como IPv4.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Solo para pruebas locales: permite http://localhost como callback. */
function allowInsecureLocalhost(url: URL): boolean {
  return (
    process.env.EVENTS_ALLOW_INSECURE_LOCALHOST === "true" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  );
}

export class CallbackUrlError extends Error {}

export function validateCallbackUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CallbackUrlError("Callback URL is not a valid URL");
  }
  if (allowInsecureLocalhost(url)) return url;
  if (url.protocol !== "https:") {
    throw new CallbackUrlError("Callback URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new CallbackUrlError("Callback URL must not contain credentials");
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new CallbackUrlError("Callback URL points to a non-public address");
  }
  return url;
}

/**
 * Resuelve el DNS en el momento de conectar y solo deja conectar a IPs públicas.
 * Como el socket usa la IP validada, un cambio de DNS entre la validación y la
 * conexión (DNS rebinding) no sirve para llegar a la red interna.
 */
const publicOnlyLookup: typeof dnsLookup = ((
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const allowed = addresses.filter((a) => isPublicAddress(a.address));
    if (allowed.length === 0) {
      return callback(
        Object.assign(new Error(`Blocked non-public address for ${hostname}`), {
          code: "EBLOCKED",
        }),
        []
      );
    }
    if (options.all) return callback(null, allowed);
    callback(null, allowed[0].address, allowed[0].family);
  });
}) as typeof dnsLookup;

export type DeliveryResult = { ok: boolean; status: number; body: string };

/** POST con cabeceras de Standard Webhooks. Sin redirecciones y con timeout. */
export function postSigned(
  rawUrl: string,
  opts: {
    messageId: string;
    body: string;
    secrets: string[];
    subscriptionId: string;
  }
): Promise<DeliveryResult> {
  if (Buffer.byteLength(opts.body, "utf8") > MAX_BODY_BYTES) {
    return Promise.reject(new Error("Event payload exceeds 256 KiB"));
  }

  const url = validateCallbackUrl(rawUrl);
  const signedAt = new Date();
  // Durante una rotación de clave se firma con las dos (firmas separadas por espacio).
  const signature = opts.secrets
    .map((secret) => new Webhook(secret).sign(opts.messageId, signedAt, opts.body))
    .join(" ");

  const insecure = url.protocol === "http:";
  const request = insecure ? http.request : https.request;

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        timeout: TIMEOUT_MS,
        ...(insecure ? {} : { lookup: publicOnlyLookup }),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(opts.body, "utf8"),
          "webhook-id": opts.messageId,
          "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
          "webhook-signature": signature,
          "X-MCP-Subscription-Id": opts.subscriptionId,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 64 * 1024) chunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          // Las redirecciones cuentan como fallo: no se siguen.
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(opts.body);
  });
}
