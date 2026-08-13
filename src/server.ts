import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { PokeApiClient } from "./pokeapi-client.js";
import { buildWidgetHtml, WIDGET_URI } from "./widget-resource.js";

const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
} as const;

const pokemonOutputSchema = {
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
};

const WIDGET_TOOL_META = {
  ui: { resourceUri: WIDGET_URI },
  "openai/toolInvocation/invoking": "Rendering Pokémon card…",
  "openai/toolInvocation/invoked": "Pokémon card ready.",
};

export function createPokemonMcpServer() {
  const pokeapi = new PokeApiClient(
    process.env.POKEAPI_BASE_URL ?? "https://pokeapi.co/api/v2"
  );

  const server = new McpServer(
    {
      name: "pokemon-mcp",
      version: "0.2.0",
    },
    {
      instructions:
        "Use list_pokemon to browse. Use get_pokemon for one Pokémon by name or id. Use get_type for type matchups. After get_pokemon, call render_pokemon_widget with the same fields to show the visual card. Prefer stable ids/names from tool results.",
    }
  );

  const widgetHtml = buildWidgetHtml();

  registerAppResource(
    server,
    "pokemon-card-widget",
    WIDGET_URI,
    {},
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: {
                resourceDomains: [
                  "https://raw.githubusercontent.com",
                  "https://fonts.googleapis.com",
                  "https://fonts.gstatic.com",
                ],
              },
            },
          },
        },
      ],
    })
  );

  server.registerTool(
    "list_pokemon",
    {
      title: "List Pokémon",
      description:
        "Use this when the user wants to browse or discover Pokémon. Returns a page of names and ids from PokéAPI. Does not render UI.",
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
        "Fetch details for one Pokémon by name or id. Data-only tool: after this, call render_pokemon_widget to show the visual card.",
      inputSchema: {
        nameOrId: z
          .string()
          .min(1)
          .describe("Pokémon name or id, e.g. pikachu or 25."),
      },
      outputSchema: pokemonOutputSchema,
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
              text: `${pokemon.name} (#${pokemon.id}) — types: ${pokemon.types.join(", ")}. Height ${pokemon.height}, weight ${pokemon.weight}. Next: call render_pokemon_widget with these fields.`,
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
        "Use this when the user asks about a type's matchups or which Pokémon have that type. Accepts a type name (e.g. electric) or id. Does not render UI.",
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

  registerAppTool(
    server,
    "render_pokemon_widget",
    {
      title: "Render Pokémon widget",
      description:
        "Render the visual Pokémon card. Always call get_pokemon first, then pass its fields (id, name, height, weight, types, abilities, stats, spriteUrl, speciesUrl) to this tool.",
      inputSchema: {
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
      outputSchema: pokemonOutputSchema,
      annotations: READ_ONLY,
      _meta: WIDGET_TOOL_META,
    },
    async (pokemon) => ({
      structuredContent: pokemon,
      content: [
        {
          type: "text",
          text: `Showing card for ${pokemon.name} (#${pokemon.id}). Do not repeat the stats as a markdown table.`,
        },
      ],
    })
  );

  return server;
}
