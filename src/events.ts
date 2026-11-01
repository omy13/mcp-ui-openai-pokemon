import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  activeSubscriptions,
  deleteSubscription,
  getSubscription,
  saveSubscription,
  subscriptionId,
  type Subscription,
} from "./event-subscriptions.js";
import type { PokemonDetail } from "./pokeapi-client.js";
import { CallbackUrlError, postSigned, validateCallbackUrl } from "./webhook-delivery.js";

// MCP Events (borrador de extensión, soportado por ChatGPT):
// https://developers.openai.com/plugins/build/mcp-events

/**
 * Esta demo no tiene autenticación, así que todas las suscripciones son del mismo
 * "usuario". En un servidor real, usa el usuario autenticado de la petición.
 */
const PRINCIPAL = "anonymous";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 1000;
const VERIFICATION_CACHE_MS = 60 * 60 * 1000;
const SECRET_ROTATION_WINDOW_MS = 5 * 60 * 1000;
const CALLBACK_ENDPOINT_ERROR = -32015;

export const POKEMON_APPEARED = {
  name: "pokemon.appeared",
  description:
    "A wild Pokémon appeared. Optionally filter by type (e.g. fire, water, electric). The payload includes id, name, types and spriteUrl; call get_pokemon for full details.",
  delivery: ["webhook"],
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "Only notify for Pokémon of this type, lowercase English name (e.g. fire). Omit to receive every appearance.",
      },
    },
    additionalProperties: false,
  },
  payloadSchema: {
    type: "object",
    properties: {
      id: { type: "number" },
      name: { type: "string" },
      types: { type: "array", items: { type: "string" } },
      spriteUrl: { type: ["string", "null"] },
    },
    required: ["id", "name", "types", "spriteUrl"],
    additionalProperties: false,
  },
} as const;

const pokemonAppearedArgs = z
  .object({ type: z.string().regex(/^[a-z-]+$/).optional() })
  .strict();

const deliverySchema = z.object({
  mode: z.literal("webhook"),
  url: z.string(),
  secret: z.string().optional(),
});

const EventsListRequestSchema = z.object({
  method: z.literal("events/list"),
  params: z.object({ cursor: z.string().optional() }).passthrough().optional(),
});

const EventsSubscribeRequestSchema = z.object({
  method: z.literal("events/subscribe"),
  params: z
    .object({
      name: z.string(),
      arguments: z.record(z.unknown()).default({}),
      delivery: deliverySchema,
      cursor: z.string().nullable().optional(),
      ttlMs: z.number().int().positive().nullable().optional(),
    })
    .passthrough(),
});

const EventsUnsubscribeRequestSchema = z.object({
  method: z.literal("events/unsubscribe"),
  params: z
    .object({
      name: z.string(),
      arguments: z.record(z.unknown()).default({}),
      delivery: deliverySchema.omit({ secret: true }),
    })
    .passthrough(),
});

function callbackError(reason: string, message: string): McpError {
  return new McpError(CALLBACK_ENDPOINT_ERROR, message, { reason });
}

/** `whsec_` + base64 que decodifica a 24–64 bytes. */
function assertValidSecret(secret: string | undefined): string {
  const match = secret?.match(/^whsec_([A-Za-z0-9+/]+={0,2})$/);
  const bytes = match ? Buffer.from(match[1], "base64").length : 0;
  if (!match || bytes < 24 || bytes > 64) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "delivery.secret must be whsec_ followed by a base64 key of 24-64 bytes"
    );
  }
  return secret!;
}

function parseArgs(args: Record<string, unknown>) {
  const parsed = pokemonAppearedArgs.safeParse(args);
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid arguments: ${parsed.error.message}`);
  }
  return parsed.data;
}

const verifiedCallbacks = new Map<string, number>();

/** Manda un reto firmado y exige que el callback lo devuelva igual. */
async function verifyCallback(url: string, secret: string, subId: string) {
  const cacheKey = `${PRINCIPAL} ${url}`;
  if ((verifiedCallbacks.get(cacheKey) ?? 0) > Date.now()) return;

  const challenge = randomBytes(24).toString("base64url");
  let result;
  try {
    result = await postSigned(url, {
      messageId: `msg_verification_${randomUUID()}`,
      body: JSON.stringify({ type: "verification", challenge }),
      secrets: [secret],
      subscriptionId: subId,
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.message === "timeout" ? "timeout" : "unreachable";
    throw callbackError(reason, "Callback verification request failed");
  }

  let echoed = "";
  try {
    echoed = String(JSON.parse(result.body).challenge ?? "");
  } catch {
    // respuesta no JSON: se trata como reto fallido
  }
  const expected = Buffer.from(challenge);
  const received = Buffer.from(echoed);
  const matches =
    result.ok && expected.length === received.length && timingSafeEqual(expected, received);
  if (!matches) {
    throw callbackError("challenge_failed", "Callback did not echo the verification challenge");
  }

  verifiedCallbacks.set(cacheKey, Date.now() + VERIFICATION_CACHE_MS);
}

function grantedExpiry(ttlMs: number | null | undefined): string | null {
  if (ttlMs === null) return null;
  const ttl = Math.max(ttlMs ?? DEFAULT_TTL_MS, MIN_TTL_MS);
  return new Date(Date.now() + ttl).toISOString();
}

/** Registra la capacidad `events` y los métodos events/list, subscribe y unsubscribe. */
export function registerPokemonEvents(mcpServer: McpServer) {
  const server = mcpServer.server;

  // `events` no está en los tipos del SDK: es una extensión.
  server.registerCapabilities({ events: {} } as Record<string, object>);

  server.setRequestHandler(EventsListRequestSchema, async () => ({
    events: [POKEMON_APPEARED],
  }));

  server.setRequestHandler(EventsSubscribeRequestSchema, async ({ params }) => {
    if (params.name !== POKEMON_APPEARED.name) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown event: ${params.name}`);
    }
    const args = parseArgs(params.arguments);
    const secret = assertValidSecret(params.delivery.secret);

    try {
      validateCallbackUrl(params.delivery.url);
    } catch (error) {
      if (error instanceof CallbackUrlError) {
        throw callbackError("invalid_url", error.message);
      }
      throw error;
    }

    const id = subscriptionId(PRINCIPAL, params.delivery.url, params.name, args);
    await verifyCallback(params.delivery.url, secret, id);

    const existing = getSubscription(id);
    const rotating = existing && existing.secret !== secret;
    const sub: Subscription = {
      id,
      principal: PRINCIPAL,
      name: params.name,
      arguments: args,
      url: params.delivery.url,
      secret,
      ...(rotating
        ? {
            previousSecret: existing.secret,
            previousSecretUntil: new Date(Date.now() + SECRET_ROTATION_WINDOW_MS).toISOString(),
          }
        : {}),
      expiresAt: grantedExpiry(params.ttlMs),
      updatedAt: new Date().toISOString(),
    };
    saveSubscription(sub);

    // Este evento no admite replay: cursor siempre null.
    return { id, refreshBefore: sub.expiresAt, cursor: null, truncated: false };
  });

  server.setRequestHandler(EventsUnsubscribeRequestSchema, async ({ params }) => {
    const args = pokemonAppearedArgs.safeParse(params.arguments);
    if (args.success) {
      deleteSubscription(subscriptionId(PRINCIPAL, params.delivery.url, params.name, args.data));
    }
    // Idempotente: cancelar algo que no existe también responde vacío.
    return {};
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function signingSecrets(sub: Subscription): string[] {
  const rotating =
    sub.previousSecret && sub.previousSecretUntil && new Date(sub.previousSecretUntil) > new Date();
  return rotating ? [sub.secret, sub.previousSecret!] : [sub.secret];
}

/** Envía un evento con reintentos. Mismo eventId en cada intento; firma nueva cada vez. */
async function deliver(sub: Subscription, event: { eventId: string } & Record<string, unknown>) {
  const body = JSON.stringify(event);
  const delays = [0, 1_000, 4_000];
  let last = "";

  for (const delay of delays) {
    await sleep(delay);
    try {
      const result = await postSigned(sub.url, {
        messageId: event.eventId,
        body,
        secrets: signingSecrets(sub),
        subscriptionId: sub.id,
      });
      if (result.ok) return { subscriptionId: sub.id, delivered: true, status: result.status };
      if (result.status === 410) {
        // El receptor dice que la suscripción ya no existe.
        deleteSubscription(sub.id);
        return { subscriptionId: sub.id, delivered: false, status: 410 };
      }
      if (result.status === 413) {
        return { subscriptionId: sub.id, delivered: false, status: 413 };
      }
      last = `HTTP ${result.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  return { subscriptionId: sub.id, delivered: false, error: last };
}

/** Avisa a todas las suscripciones de `pokemon.appeared` cuyo filtro encaja. */
export async function dispatchPokemonAppeared(pokemon: PokemonDetail) {
  const matching = activeSubscriptions(POKEMON_APPEARED.name).filter((sub) => {
    const type = sub.arguments.type;
    return typeof type !== "string" || pokemon.types.includes(type);
  });

  const timestamp = new Date().toISOString();
  const data = {
    id: pokemon.id,
    name: pokemon.name,
    types: pokemon.types,
    spriteUrl: pokemon.spriteUrl,
  };

  // Un eventId por suscripción: cada entrega es un mensaje distinto para el receptor.
  const deliveries = await Promise.all(
    matching.map((sub) =>
      deliver(sub, {
        eventId: `evt_${randomUUID()}`,
        name: POKEMON_APPEARED.name,
        timestamp,
        data,
        cursor: null,
      })
    )
  );
  return { pokemon: pokemon.name, types: pokemon.types, deliveries };
}
