import { PokeApiClient } from "./pokeapi-client.js";
import { buildWidgetHtml } from "./widget-resource.js";

export type WidgetPreviewData = {
  id: number;
  name: string;
  height: number;
  weight: number;
  types: string[];
  abilities: Array<{ name: string; isHidden: boolean }>;
  stats: Array<{ name: string; baseStat: number }>;
  spriteUrl: string | null;
  speciesUrl: string;
};

export const MOCK_WIDGET_DATA: WidgetPreviewData = {
  id: 25,
  name: "pikachu",
  height: 4,
  weight: 60,
  types: ["electric"],
  abilities: [
    { name: "static", isHidden: false },
    { name: "lightning-rod", isHidden: true },
  ],
  stats: [
    { name: "hp", baseStat: 35 },
    { name: "attack", baseStat: 55 },
    { name: "defense", baseStat: 40 },
    { name: "special-attack", baseStat: 50 },
    { name: "special-defense", baseStat: 50 },
    { name: "speed", baseStat: 90 },
  ],
  spriteUrl:
    "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png",
  speciesUrl: "https://pokeapi.co/api/v2/pokemon-species/25/",
};

export function buildWidgetPreviewHtml(toolOutput: WidgetPreviewData): string {
  const payload = JSON.stringify(toolOutput).replace(/</g, "\\u003c");
  const bootstrap = `<script>window.openai = { toolOutput: ${payload} };</script>`;
  return buildWidgetHtml().replace("</head>", `${bootstrap}\n  </head>`);
}

export async function fetchLiveWidgetPreviewData(): Promise<WidgetPreviewData> {
  const pokeapi = new PokeApiClient(
    process.env.POKEAPI_BASE_URL ?? "https://pokeapi.co/api/v2"
  );
  return pokeapi.getPokemon("pikachu");
}
