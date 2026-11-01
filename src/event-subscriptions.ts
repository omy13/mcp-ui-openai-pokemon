import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Subscription = {
  id: string;
  principal: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  secret: string;
  /** Clave anterior durante una rotación; se sigue firmando con ella hasta `previousSecretUntil`. */
  previousSecret?: string;
  previousSecretUntil?: string;
  /** null = sin caducidad (el cliente pidió `ttlMs: null`). */
  expiresAt: string | null;
  updatedAt: string;
};

const STORE_PATH = process.env.EVENTS_STORE_PATH ?? "data/subscriptions.json";

let cache: Map<string, Subscription> | null = null;

function load(): Map<string, Subscription> {
  if (cache) return cache;
  try {
    const list = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Subscription[];
    cache = new Map(list.map((s) => [s.id, s]));
  } catch {
    cache = new Map();
  }
  return cache;
}

function persist() {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify([...load().values()], null, 2));
}

/** JSON con las claves ordenadas: `{a,b}` y `{b,a}` dan el mismo resultado. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Mismo usuario + callback + evento + filtros → mismo id (suscribirse dos veces no duplica). */
export function subscriptionId(
  principal: string,
  url: string,
  name: string,
  args: Record<string, unknown>
): string {
  const hash = createHash("sha256")
    .update(canonicalJson({ principal, url, name, args }))
    .digest("hex");
  return `sub_${hash.slice(0, 24)}`;
}

export function getSubscription(id: string): Subscription | undefined {
  return load().get(id);
}

export function saveSubscription(sub: Subscription) {
  load().set(sub.id, sub);
  persist();
}

export function deleteSubscription(id: string): boolean {
  const deleted = load().delete(id);
  if (deleted) persist();
  return deleted;
}

export function activeSubscriptions(name: string, now = new Date()): Subscription[] {
  return [...load().values()].filter(
    (s) => s.name === name && (s.expiresAt === null || new Date(s.expiresAt) > now)
  );
}
