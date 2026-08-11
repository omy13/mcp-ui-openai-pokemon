import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PokeApiClient } from "./pokeapi-client.js";

const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

export function createPokemonMcpServer() {
  const pokeapi = new PokeApiClient(
    process.env.POKEAPI_BASE_URL ?? "https://pokeapi.co/api/v2"
  );

  const server = new McpServer(
    {
      name: "pokemon-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Use list_pokemon to browse or page through Pokémon. Use get_pokemon for details of one Pokémon by name or id. Use get_type for type matchups. Prefer stable ids/names from tool results in follow-up calls.",
    }
  );

  server.registerTool(
    "list_pokemon",
    {
      title: "List Pokémon",
      description:
        "Use this when the user wants to browse or discover Pokémon. Returns a page of names and ids from PokéAPI.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Page size. Defaults to 20, max 100."),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number of results to skip. Defaults to 0."),
      },
      outputSchema: {
        count: z.number().int(),
        limit: z.number().int(),
        offset: z.number().int(),
        results: z.array(
          z.object({
            id: z.number().int(),
            name: z.string(),
            url: z.string(),
          })
        ),
      },
      annotations: READ_ONLY,
    },
    async ({ limit, offset }) => {
      const pageLimit = limit ?? 20;
      const pageOffset = offset ?? 0;
      const page = await pokeapi.listPokemon(pageLimit, pageOffset);

      return {
        structuredContent: {
          count: page.count,
          limit: pageLimit,
          offset: pageOffset,
          results: page.results,
        },
        content: [
          {
            type: "text",
            text: `Found ${page.count} Pokémon total. Showing ${page.results.length} from offset ${pageOffset}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_pokemon",
    {
      title: "Get Pokémon details",
      description:
        "Use this when the user asks about a specific Pokémon. Accepts a name (e.g. pikachu) or numeric id.",
      inputSchema: {
        nameOrId: z
          .string()
          .min(1)
          .describe("Pokémon name or id, e.g. pikachu or 25."),
      },
      outputSchema: {
        id: z.number().int(),
        name: z.string(),
        height: z.number(),
        weight: z.number(),
        types: z.array(z.string()),
        abilities: z.array(
          z.object({
            name: z.string(),
            isHidden: z.boolean(),
          })
        ),
        stats: z.array(
          z.object({
            name: z.string(),
            baseStat: z.number().int(),
          })
        ),
        spriteUrl: z.string().nullable(),
        speciesUrl: z.string(),
      },
      annotations: READ_ONLY,
    },
    async ({ nameOrId }) => {
      try {
        const pokemon = await pokeapi.getPokemon(nameOrId);

        return {
          structuredContent: pokemon,
          content: [
            {
              type: "text",
              text: `${pokemon.name} (#${pokemon.id}) — types: ${pokemon.types.join(", ")}. Height ${pokemon.height}, weight ${pokemon.weight}.`,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown PokéAPI error";
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    }
  );

  server.registerTool(
    "get_type",
    {
      title: "Get Pokémon type",
      description:
        "Use this when the user asks about a type's matchups or which Pokémon have that type. Accepts a type name (e.g. electric) or id.",
      inputSchema: {
        nameOrId: z
          .string()
          .min(1)
          .describe("Type name or id, e.g. electric or 13."),
      },
      outputSchema: {
        id: z.number().int(),
        name: z.string(),
        pokemon: z.array(z.string()),
        damageRelations: z.object({
          doubleDamageTo: z.array(z.string()),
          doubleDamageFrom: z.array(z.string()),
          halfDamageTo: z.array(z.string()),
          halfDamageFrom: z.array(z.string()),
          noDamageTo: z.array(z.string()),
          noDamageFrom: z.array(z.string()),
        }),
      },
      annotations: READ_ONLY,
    },
    async ({ nameOrId }) => {
      try {
        const type = await pokeapi.getType(nameOrId);

        return {
          structuredContent: type,
          content: [
            {
              type: "text",
              text: `Type ${type.name}: strong vs ${type.damageRelations.doubleDamageTo.join(", ") || "none"}; weak to ${type.damageRelations.doubleDamageFrom.join(", ") || "none"}. Showing up to ${type.pokemon.length} Pokémon of this type.`,
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown PokéAPI error";
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    }
  );

  return server;
}
