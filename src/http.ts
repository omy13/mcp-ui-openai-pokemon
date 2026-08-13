import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  buildWidgetPreviewHtml,
  fetchLiveWidgetPreviewData,
  MOCK_WIDGET_DATA,
} from "./preview-widget.js";
import { createPokemonMcpServer } from "./server.js";

const port = Number(process.env.PORT ?? 8787);
const MCP_PATH = "/mcp";

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res
      .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
      .end(
        "Pokémon MCP server\n\nPreview widget (no ChatGPT):\n  /preview       mock Pikachu\n  /preview/live  live PokéAPI\n\nMCP endpoint: /mcp\n"
      );
    return;
  }

  if (req.method === "GET" && url.pathname === "/preview") {
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(buildWidgetPreviewHtml(MOCK_WIDGET_DATA));
    return;
  }

  if (req.method === "GET" && url.pathname === "/preview/live") {
    try {
      const data = await fetchLiveWidgetPreviewData();
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(buildWidgetPreviewHtml(data));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown preview error";
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(message);
    }
    return;
  }

  const mcpMethods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && mcpMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createPokemonMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(port, () => {
  console.log(
    `Pokémon MCP server listening on http://localhost:${port}${MCP_PATH}`
  );
  console.log(`Widget preview (mock): http://localhost:${port}/preview`);
  console.log(`Widget preview (live): http://localhost:${port}/preview/live`);
});
