import { PokeApiClient } from "./pokeapi-client.js";

const pokeapi = new PokeApiClient(
  process.env.POKEAPI_BASE_URL ?? "https://pokeapi.co/api/v2"
);

const list = await pokeapi.listPokemon(5, 0);
console.log(
  "list_pokemon:",
  list.count,
  "total —",
  list.results.map((p) => `${p.id}:${p.name}`).join(", ")
);

const pikachu = await pokeapi.getPokemon("pikachu");
console.log(
  "get_pokemon:",
  `${pikachu.name} (#${pikachu.id})`,
  `types=${pikachu.types.join("/")}`,
  `sprite=${pikachu.spriteUrl ? "yes" : "no"}`
);

const electric = await pokeapi.getType("electric");
console.log(
  "get_type:",
  electric.name,
  "→ double damage to",
  electric.damageRelations.doubleDamageTo.join(", ") || "(none)"
);

console.log("Smoke test passed.");
