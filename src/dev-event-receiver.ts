// Receptor local para probar MCP Events sin ChatGPT: hace de "ChatGPT".
// 1. Arranca un servidor en :9000 que verifica firmas y responde al reto.
// 2. Se suscribe a `pokemon.appeared` en el servidor MCP.
// El servidor MCP debe arrancar con EVENTS_ALLOW_INSECURE_LOCALHOST=true.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Webhook } from "standardwebhooks";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:8787/mcp";
const PORT = Number(process.env.RECEIVER_PORT ?? 9000);
const TYPE = process.argv[2]; // opcional: tipo a vigilar, p. ej. fire

const secret = `whsec_${randomBytes(32).toString("base64")}`;
const webhook = new Webhook(secret);
const callbackUrl = `http://localhost:${PORT}/callback`;

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    let payload: Record<string, unknown>;
    try {
      payload = webhook.verify(body, {
        "webhook-id": String(req.headers["webhook-id"] ?? ""),
        "webhook-timestamp": String(req.headers["webhook-timestamp"] ?? ""),
        "webhook-signature": String(req.headers["webhook-signature"] ?? ""),
      }) as Record<string, unknown>;
    } catch {
      console.log("✗ Firma no válida, rechazado");
      res.writeHead(401).end();
      return;
    }

    if (payload.type === "verification") {
      console.log("✓ Reto de verificación recibido y devuelto");
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }

    console.log("✓ Evento recibido:", JSON.stringify(payload, null, 2));
    res.writeHead(200).end();
  });
}).listen(PORT, async () => {
  console.log(`Receptor escuchando en ${callbackUrl}`);

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "events/subscribe",
      params: {
        name: "pokemon.appeared",
        arguments: TYPE ? { type: TYPE } : {},
        delivery: { mode: "webhook", url: callbackUrl, secret },
        cursor: null,
      },
    }),
  });
  console.log("events/subscribe →", await response.text());
  console.log(
    "\nAhora dispara un evento:\n  curl -X POST 'http://localhost:8787/dev/wild-pokemon?name=charmander' -H \"Authorization: Bearer $DEV_TRIGGER_TOKEN\""
  );
});
