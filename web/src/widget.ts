export type PokemonWidgetData = {
  id: number;
  name: string;
  height: number;
  weight: number;
  types: string[];
  abilities: Array<{ name: string; isHidden: boolean }>;
  stats: Array<{ name: string; baseStat: number }>;
  spriteUrl: string | null;
  speciesUrl?: string;
  typeMatchups?: {
    name: string;
    doubleDamageTo: string[];
    doubleDamageFrom: string[];
  };
};

const TYPE_COLORS: Record<string, string> = {
  normal: "#A8A77A",
  fire: "#EE8130",
  water: "#6390F0",
  electric: "#F7D02C",
  grass: "#7AC74C",
  ice: "#96D9D6",
  fighting: "#C22E28",
  poison: "#A33EA1",
  ground: "#E2BF65",
  flying: "#A98FF3",
  psychic: "#F95587",
  bug: "#A6B91A",
  rock: "#B6A136",
  ghost: "#735797",
  dragon: "#6F35FC",
  dark: "#705746",
  steel: "#B7B7CE",
  fairy: "#D685AD",
};

const STAT_LABELS: Record<string, string> = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  "special-attack": "SpA",
  "special-defense": "SpD",
  speed: "Spe",
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function unwrapStructuredContent(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  let v = value as Record<string, unknown>;
  for (let depth = 0; depth < 3; depth++) {
    if (v && typeof v === "object" && "structuredContent" in v) {
      v = v.structuredContent as Record<string, unknown>;
      continue;
    }
    const result = v?.result as Record<string, unknown> | undefined;
    if (result?.structuredContent) {
      v = result.structuredContent as Record<string, unknown>;
      continue;
    }
    break;
  }
  return v;
}

function normalizePayload(value: unknown): PokemonWidgetData | null {
  const raw = unwrapStructuredContent(value);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.name !== "string" || typeof o.id !== "number") return null;
  if (!Array.isArray(o.types) || !Array.isArray(o.stats)) return null;

  const typeMatchups =
    o.typeMatchups && typeof o.typeMatchups === "object"
      ? (o.typeMatchups as PokemonWidgetData["typeMatchups"])
      : undefined;

  return {
    id: o.id,
    name: o.name,
    height: Number(o.height ?? 0),
    weight: Number(o.weight ?? 0),
    types: o.types.map(String),
    abilities: Array.isArray(o.abilities)
      ? o.abilities.map((a) => {
          const ability = a as { name?: string; isHidden?: boolean };
          return {
            name: String(ability.name ?? ""),
            isHidden: Boolean(ability.isHidden),
          };
        })
      : [],
    stats: o.stats.map((s) => {
      const stat = s as { name?: string; baseStat?: number };
      return {
        name: String(stat.name ?? ""),
        baseStat: Number(stat.baseStat ?? 0),
      };
    }),
    spriteUrl: typeof o.spriteUrl === "string" ? o.spriteUrl : null,
    speciesUrl: typeof o.speciesUrl === "string" ? o.speciesUrl : undefined,
    typeMatchups,
  };
}

export function mountWidget() {
  const root = $("app");
  const statusEl = $("widget-status");
  const emptyEl = $("empty-state");
  const cardEl = $("pokemon-card");
  const spriteEl = $("sprite") as HTMLImageElement;
  const nameEl = $("name");
  const dexEl = $("dex");
  const typesEl = $("types");
  const metaEl = $("meta");
  const abilitiesEl = $("abilities");
  const statsEl = $("stats");
  const matchupsEl = $("matchups");
  const matchupsSection = $("matchups-section");
  const lookupInput = $("lookup-input") as HTMLInputElement;
  const lookupBtn = $("lookup-btn") as HTMLButtonElement;
  const typeBtn = $("type-btn") as HTMLButtonElement;

  let current: PokemonWidgetData | null = null;
  let lastToolInput: Record<string, unknown> | null = null;
  let rpcId = 0;
  const pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();

  function rpcNotify(method: string, params: unknown = {}) {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  function rpcRequest(method: string, params: unknown, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++rpcId;
      const timer = window.setTimeout(() => {
        if (pendingRequests.delete(id)) reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      pendingRequests.set(id, {
        resolve: (v) => {
          window.clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          window.clearTimeout(timer);
          reject(e);
        },
      });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  function getHostOpenAi(): {
    toolOutput?: unknown;
    toolInput?: unknown;
    callTool?: (name: string, args: unknown) => Promise<unknown>;
    notifyIntrinsicHeight?: (height: number) => void;
  } | undefined {
    return (window as unknown as { openai?: Record<string, unknown> }).openai as
      | {
          toolOutput?: unknown;
          toolInput?: unknown;
          callTool?: (name: string, args: unknown) => Promise<unknown>;
          notifyIntrinsicHeight?: (height: number) => void;
        }
      | undefined;
  }

  function setStatus(msg: string, kind: "info" | "ok" | "error" = "info") {
    statusEl.textContent = msg;
    statusEl.className =
      "widget-status" +
      (kind === "ok" ? " widget-status--ok" : kind === "error" ? " widget-status--error" : "");
  }

  function reportSize() {
    const html = document.documentElement;
    const prev = html.style.height;
    html.style.height = "max-content";
    const height = Math.max(360, Math.ceil(html.getBoundingClientRect().height));
    html.style.height = prev;
    rpcNotify("ui/notifications/size-changed", { width: null, height });
    const openai = getHostOpenAi();
    openai?.notifyIntrinsicHeight?.(height);
  }

  async function callTool(name: string, args: unknown) {
    try {
      return await rpcRequest("tools/call", { name, arguments: args }, 30000);
    } catch {
      const openai = getHostOpenAi();
      if (openai?.callTool) return openai.callTool(name, args);
      throw new Error("callTool no disponible en este host");
    }
  }

  function render(data: PokemonWidgetData) {
    current = data;
    emptyEl.hidden = true;
    cardEl.hidden = false;

    const primaryType = data.types[0] ?? "normal";
    const typeColor = TYPE_COLORS[primaryType] ?? "#F5C518";
    root.style.setProperty("--glow", `${typeColor}55`);
    root.style.setProperty("--accent", typeColor);

    nameEl.textContent = data.name;
    dexEl.textContent = `#${String(data.id).padStart(3, "0")}`;

    if (data.spriteUrl) {
      spriteEl.src = data.spriteUrl;
      spriteEl.alt = data.name;
      spriteEl.hidden = false;
    } else {
      spriteEl.hidden = true;
    }

    typesEl.innerHTML = data.types
      .map(
        (type) =>
          `<span class="type-pill" style="--type:${TYPE_COLORS[type] ?? typeColor}">${type}</span>`
      )
      .join("");

    const heightM = (data.height / 10).toFixed(1);
    const weightKg = (data.weight / 10).toFixed(1);
    metaEl.innerHTML = `
      <span class="meta-chip">${heightM} m</span>
      <span class="meta-chip">${weightKg} kg</span>
    `;

    abilitiesEl.innerHTML = data.abilities
      .map(
        (ability) => `
        <li class="ability">
          ${ability.name}
          ${ability.isHidden ? "<span>Hidden ability</span>" : "<span>Ability</span>"}
        </li>`
      )
      .join("");

    statsEl.innerHTML = data.stats
      .map((stat) => {
        const pct = Math.max(4, Math.min(100, Math.round((stat.baseStat / 180) * 100)));
        const label = STAT_LABELS[stat.name] ?? stat.name;
        return `
          <div class="stat">
            <span class="stat__name">${label}</span>
            <div class="stat__track"><div class="stat__fill" data-width="${pct}%"></div></div>
            <span class="stat__value">${stat.baseStat}</span>
          </div>`;
      })
      .join("");

    requestAnimationFrame(() => {
      statsEl.querySelectorAll<HTMLElement>(".stat__fill").forEach((el) => {
        el.style.width = el.dataset.width ?? "0%";
      });
    });

    if (data.typeMatchups) {
      matchupsSection.hidden = false;
      matchupsEl.innerHTML = `
        <div class="matchup-block">
          <h4>Strong against</h4>
          <div class="meta-row">${
            data.typeMatchups.doubleDamageTo.length
              ? data.typeMatchups.doubleDamageTo
                  .map(
                    (t) =>
                      `<span class="type-pill" style="--type:${TYPE_COLORS[t] ?? "#fff"}">${t}</span>`
                  )
                  .join("")
              : `<span class="meta-chip">None</span>`
          }</div>
        </div>
        <div class="matchup-block">
          <h4>Weak against</h4>
          <div class="meta-row">${
            data.typeMatchups.doubleDamageFrom.length
              ? data.typeMatchups.doubleDamageFrom
                  .map(
                    (t) =>
                      `<span class="type-pill" style="--type:${TYPE_COLORS[t] ?? "#fff"}">${t}</span>`
                  )
                  .join("")
              : `<span class="meta-chip">None</span>`
          }</div>
        </div>`;
    } else {
      matchupsSection.hidden = true;
      matchupsEl.innerHTML = "";
    }

    typeBtn.disabled = data.types.length === 0;
    typeBtn.textContent = data.types[0]
      ? `Matchups: ${data.types[0]}`
      : "Matchups";

    lookupInput.value = data.name;
    setStatus(`${data.name} (#${data.id}) listo`, "ok");
    reportSize();
  }

  function safeRender(value: unknown): boolean {
    const payload = normalizePayload(value);
    if (!payload) return false;
    render(payload);
    return true;
  }

  function tryRenderFromHost(): boolean {
    const openai = getHostOpenAi();
    const candidates = [
      openai?.toolOutput,
      (window as unknown as { toolOutput?: unknown }).toolOutput,
    ];
    for (const candidate of candidates) {
      if (safeRender(candidate)) return true;
    }
    return false;
  }

  async function onLookup() {
    const nameOrId = lookupInput.value.trim();
    if (!nameOrId) return;
    lookupBtn.disabled = true;
    typeBtn.disabled = true;
    setStatus(`Buscando ${nameOrId}…`);
    try {
      const result = await callTool("get_pokemon", { nameOrId });
      if (!safeRender(result)) {
        throw new Error("Respuesta sin structuredContent usable");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
    } finally {
      lookupBtn.disabled = false;
      typeBtn.disabled = !current;
    }
  }

  async function onTypeMatchups() {
    if (!current?.types[0]) return;
    typeBtn.disabled = true;
    setStatus(`Cargando matchups de ${current.types[0]}…`);
    try {
      const result = await callTool("get_type", { nameOrId: current.types[0] });
      const typed = unwrapStructuredContent(result) as {
        name?: string;
        damageRelations?: {
          doubleDamageTo?: string[];
          doubleDamageFrom?: string[];
        };
      } | null;

      if (!typed?.name || !typed.damageRelations) {
        throw new Error("No se pudieron leer los matchups");
      }

      render({
        ...current,
        typeMatchups: {
          name: typed.name,
          doubleDamageTo: typed.damageRelations.doubleDamageTo ?? [],
          doubleDamageFrom: typed.damageRelations.doubleDamageFrom ?? [],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message, "error");
    } finally {
      typeBtn.disabled = false;
    }
  }

  lookupBtn.addEventListener("click", () => void onLookup());
  lookupInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void onLookup();
  });
  typeBtn.addEventListener("click", () => void onTypeMatchups());

  window.addEventListener(
    "message",
    (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;

      if (message.id !== undefined && pendingRequests.has(message.id)) {
        const pending = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        if (message.error) pending?.reject(message.error);
        else pending?.resolve(message.result);
        return;
      }

      if (message.method === "ui/notifications/tool-input") {
        lastToolInput =
          message.params && typeof message.params === "object"
            ? (message.params as Record<string, unknown>)
            : null;
        void lastToolInput;
      }

      if (message.method === "ui/notifications/tool-result") {
        safeRender(message.params);
      }
    },
    { passive: true }
  );

  if (!tryRenderFromHost()) {
    emptyEl.hidden = false;
    cardEl.hidden = true;
    setStatus("Esperando datos del tool render_pokemon_widget…");
  }

  reportSize();
}
