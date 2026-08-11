import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPokemonMcpServer } from "./server.js";

const server = createPokemonMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
