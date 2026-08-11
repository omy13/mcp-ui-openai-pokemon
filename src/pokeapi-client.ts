const DEFAULT_BASE_URL = "https://pokeapi.co/api/v2";

export type PokemonSummary = {
  id: number;
  name: string;
  url: string;
};

export type PokemonDetail = {
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

export type TypeDetail = {
  id: number;
  name: string;
  pokemon: string[];
  damageRelations: {
    doubleDamageTo: string[];
    doubleDamageFrom: string[];
    halfDamageTo: string[];
    halfDamageFrom: string[];
    noDamageTo: string[];
    noDamageFrom: string[];
  };
};

type NamedResource = { name: string; url: string };

function idFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/);
  if (!match) {
    throw new Error(`Could not parse id from URL: ${url}`);
  }
  return Number(match[1]);
}

export class PokeApiClient {
  constructor(private readonly baseUrl = DEFAULT_BASE_URL) {}

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url);

    if (response.status === 404) {
      throw new Error(`Not found: ${path}`);
    }

    if (!response.ok) {
      throw new Error(`PokéAPI error ${response.status} for ${path}`);
    }

    return (await response.json()) as T;
  }

  async listPokemon(limit = 20, offset = 0): Promise<{
    count: number;
    results: PokemonSummary[];
  }> {
    const data = await this.get<{
      count: number;
      results: NamedResource[];
    }>(`/pokemon?limit=${limit}&offset=${offset}`);

    return {
      count: data.count,
      results: data.results.map((item) => ({
        id: idFromUrl(item.url),
        name: item.name,
        url: item.url,
      })),
    };
  }

  async getPokemon(nameOrId: string | number): Promise<PokemonDetail> {
    const key = String(nameOrId).trim().toLowerCase();
    const data = await this.get<{
      id: number;
      name: string;
      height: number;
      weight: number;
      types: Array<{ slot: number; type: NamedResource }>;
      abilities: Array<{
        ability: NamedResource;
        is_hidden: boolean;
        slot: number;
      }>;
      stats: Array<{ base_stat: number; effort: number; stat: NamedResource }>;
      sprites: { front_default: string | null };
      species: NamedResource;
    }>(`/pokemon/${encodeURIComponent(key)}`);

    return {
      id: data.id,
      name: data.name,
      height: data.height,
      weight: data.weight,
      types: data.types
        .sort((a, b) => a.slot - b.slot)
        .map((entry) => entry.type.name),
      abilities: data.abilities
        .sort((a, b) => a.slot - b.slot)
        .map((entry) => ({
          name: entry.ability.name,
          isHidden: entry.is_hidden,
        })),
      stats: data.stats.map((entry) => ({
        name: entry.stat.name,
        baseStat: entry.base_stat,
      })),
      spriteUrl: data.sprites.front_default,
      speciesUrl: data.species.url,
    };
  }

  async getType(nameOrId: string | number): Promise<TypeDetail> {
    const key = String(nameOrId).trim().toLowerCase();
    const data = await this.get<{
      id: number;
      name: string;
      pokemon: Array<{ pokemon: NamedResource; slot: number }>;
      damage_relations: {
        double_damage_to: NamedResource[];
        double_damage_from: NamedResource[];
        half_damage_to: NamedResource[];
        half_damage_from: NamedResource[];
        no_damage_to: NamedResource[];
        no_damage_from: NamedResource[];
      };
    }>(`/type/${encodeURIComponent(key)}`);

    const names = (items: NamedResource[]) => items.map((item) => item.name);

    return {
      id: data.id,
      name: data.name,
      pokemon: data.pokemon.slice(0, 30).map((entry) => entry.pokemon.name),
      damageRelations: {
        doubleDamageTo: names(data.damage_relations.double_damage_to),
        doubleDamageFrom: names(data.damage_relations.double_damage_from),
        halfDamageTo: names(data.damage_relations.half_damage_to),
        halfDamageFrom: names(data.damage_relations.half_damage_from),
        noDamageTo: names(data.damage_relations.no_damage_to),
        noDamageFrom: names(data.damage_relations.no_damage_from),
      },
    };
  }
}
