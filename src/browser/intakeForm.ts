/**
 * Phase 1 in the browser: the settings form. Screens: name → (welcome back) → profile → tonight.
 * Produces the same Intake JSON as the files in profiles/, checked by the same parseIntake.
 */
import { formText as T } from "../config/prompts";
import { services } from "../config/services";
import { certificationFor, parseIntake, type Company, type Intake } from "../core/intake";
import { GENRES } from "../core/lexicon";

type Screen = "name" | "welcome" | "profile" | "tonight";
type Provider = { id: number; name: string; logo?: string };
type Load<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "failed" };
/* Each list is fetched once; a failed one is retried only when the profile screen is opened again (never in a loop). */

/** What the form holds while it is being filled in. */
interface Draft {
  name?: string;
  age: number;
  country: string;
  platforms: number[];
  noStream: boolean;
  maxMinutes?: number;
  avoidGenres: string[];
  company?: Company;
  youngestAge: number;
}

const freshDraft = (): Draft => ({
  age: 30, country: localeCountry(), platforms: [], noStream: false,
  maxMinutes: 120, avoidGenres: [], youngestAge: 10,
});

const draftFrom = ({ profile, tonight }: Intake): Draft => ({
  name: profile.name, age: profile.age, country: profile.country, platforms: profile.platforms,
  noStream: profile.platforms.length === 0, maxMinutes: tonight.maxMinutes, avoidGenres: tonight.avoidGenres,
  company: tonight.company, youngestAge: tonight.youngestAge,
});

const shared = (c?: Company) => c === "family" || c === "friends";

/** The contract JSON, keys in the same order as the sample files. */
function toRaw(d: Draft) {
  return {
    profile: { ...(d.name && { name: d.name }), age: d.age, country: d.country, platforms: d.noStream ? [] : d.platforms },
    tonight: {
      ...(d.maxMinutes !== undefined && { maxMinutes: d.maxMinutes }),
      avoidGenres: d.avoidGenres,
      company: d.company,
      ...(shared(d.company) && { youngestAge: d.youngestAge }),
    },
  };
}

function localeCountry(): string {
  const region = navigator.language.split("-")[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : "NL";
}

/* ---- saved profiles: one localStorage key, by lowercase name. A broken store behaves like an empty one. ---- */

const STORE_KEY = "movieAssistant.profiles";

function loadSaved(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function savedFor(name: string): Intake | undefined {
  try {
    return parseIntake(loadSaved()[name.toLowerCase()]);
  } catch {
    return undefined; // missing or no longer valid
  }
}

function save(intake: Intake) {
  if (!intake.profile.name) return; // guests are never saved
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadSaved(), [intake.profile.name.toLowerCase()]: intake }));
  } catch {
    /* storage full or blocked: the user just isn't remembered */
  }
}

/* ---- TMDB lists, through the dev-server proxy. Cached; a failure can be retried by reopening the screen. ---- */

async function tmdbGet(path: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${services.tmdb.proxy}${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`TMDB ${path} HTTP ${res.status}`);
  return res.json();
}

let regions: Load<{ code: string; name: string }[]> | undefined;
const providers = new Map<string, Load<Provider[]>>();

/** Forget failed loads, so opening the profile screen again retries them. */
function retryFailed() {
  if (regions?.state === "failed") regions = undefined;
  for (const [k, v] of providers) if (v.state === "failed") providers.delete(k);
}

function loadRegions(then: () => void) {
  if (regions) return;
  regions = { state: "loading" };
  tmdbGet("/watch/providers/regions", { language: "en-US" })
    .then((d) => {
      const list = (d.results as any[]).map((r) => ({ code: r.iso_3166_1 as string, name: r.english_name as string }));
      regions = { state: "ok", value: list.sort((a, b) => a.name.localeCompare(b.name)) };
    })
    .catch(() => (regions = { state: "failed" }))
    .finally(then);
}

/** The region's most prominent subscription services (TMDB's display order), plus any already chosen. */
function loadProviders(region: string, keep: number[], then: () => void) {
  if (providers.has(region)) return then(); // already loaded or loading: `then` runs now
  providers.set(region, { state: "loading" });
  tmdbGet("/watch/providers/movie", { language: "en-US", watch_region: region })
    .then((d) => {
      const rank = (p: any) => p.display_priorities?.[region] ?? p.display_priority ?? 999;
      const all = (d.results as any[]).sort((a, b) => rank(a) - rank(b));
      const shown = all.filter((p, i) => i < 12 || keep.includes(p.provider_id));
      providers.set(region, {
        state: "ok",
        value: shown.map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path })),
      });
    })
    .catch(() => providers.set(region, { state: "failed" }))
    .finally(then);
}

/* ---- rendering ---- */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const chip = (on: boolean, attrs: string, label: string) =>
  `<button type="button" class="chip${on ? " on" : ""}" aria-pressed="${on}" ${attrs}>${label}</button>`;

interface IntakeForm {
  /** Show the form at a screen: "name" for a new visitor, "tonight" to change tonight's settings mid-evening. */
  open(screen: "name" | "tonight"): void;
  /** Re-check whether "Let's go" may be pressed (call when speech or the machine changes). */
  refresh(): void;
}

/**
 * `blocked()` says why a conversation cannot start yet (speech not ready, still talking), or null when it can.
 * `onDone` gets the checked Intake; the form has already saved it (unless guest).
 */
export function createIntakeForm(root: HTMLElement, opts: { onDone(intake: Intake): void; blocked(): string | null }): IntakeForm {
  let screen: Screen = "name";
  let d = freshDraft();
  let error = "";

  const go = (s: Screen) => {
    screen = s;
    error = "";
    render();
  };

  function render() {
    root.innerHTML = { name: nameScreen, welcome: welcomeScreen, profile: profileScreen, tonight: tonightScreen }[screen]();
    root.querySelector<HTMLInputElement>("input[autofocus]")?.focus();
    refresh();
  }

  function nameScreen() {
    return `
      <h2>${T.name.heading}</h2>
      <label class="q" for="f-name">${T.name.question}</label>
      <input id="f-name" type="text" maxlength="40" autocomplete="given-name" placeholder="${T.name.placeholder}" value="${esc(d.name ?? "")}" autofocus />
      <div class="row">
        <button type="button" class="primary" data-act="name-next">${T.name.next}</button>
        <button type="button" data-act="guest">${T.name.guest}</button>
      </div>
      <p class="hint">${T.name.guestNote}</p>`;
  }

  function welcomeScreen() {
    const s = savedFor(d.name!)!;
    const c = certificationFor(s.tonight.youngestAge);
    return `
      <h2>${esc(T.welcome.heading(s.profile.name!))}</h2>
      <p class="q">${T.welcome.question}</p>
      <p class="summary">${s.profile.country} · ${T.tonight.companies[s.tonight.company]}${shared(s.tonight.company) ? ` · ${T.tonight.rating(c)}` : ""}
        · ${s.tonight.maxMinutes ? T.tonight.minutes(s.tonight.maxMinutes) : T.tonight.noLimit}</p>
      <div class="row">
        <button type="button" class="primary" data-act="use-saved">${T.welcome.use}</button>
        <button type="button" data-act="change-saved">${T.welcome.change}</button>
        <button type="button" data-act="not-me">${T.welcome.notMe}</button>
      </div>`;
  }

  function profileScreen() {
    loadRegions(render);
    const countries =
      regions?.state === "ok"
        ? regions.value.map((r) => `<option value="${r.code}"${r.code === d.country ? " selected" : ""}>${esc(r.name)}</option>`).join("")
        : `<option value="${d.country}" selected>${regions?.state === "failed" ? d.country : T.profile.loading}</option>`;

    if (!d.noStream && !providers.has(d.country)) loadProviders(d.country, d.platforms, render);
    const p = providers.get(d.country) ?? { state: "loading" as const };
    const chips =
      d.noStream
        ? ""
        : p.state === "loading"
          ? `<p class="hint">${T.profile.loading}</p>`
          : p.state === "failed"
            ? `<p class="warn">${T.profile.loadFailed}</p>`
            : p.value
                .map((x) => chip(d.platforms.includes(x.id), `data-platform="${x.id}"`,
                  `${x.logo ? `<img src="https://image.tmdb.org/t/p/w45${x.logo}" alt="" />` : ""}${esc(x.name)}`))
                .join("");
    return `
      <h2>${T.profile.heading}</h2>
      <label class="q" for="f-age">${T.profile.age}: <b id="v-age">${d.age}</b></label>
      <input id="f-age" type="range" min="6" max="99" value="${d.age}" />
      <label class="q" for="f-country">${T.profile.country}</label>
      <select id="f-country"${regions?.state === "ok" ? "" : " disabled"}>${countries}</select>
      <p class="q">${T.profile.platforms}</p>
      <p class="hint">${T.profile.platformsHint}</p>
      <div class="chips">
        ${chips}
        ${chip(d.noStream, 'data-act="no-stream"', p.state === "failed" && !d.noStream ? T.profile.continueWithout : T.profile.noStream)}
      </div>
      <p class="attribution">${T.profile.attribution}</p>
      <div class="row">
        <button type="button" data-act="to-name">${T.back}</button>
        <button type="button" class="primary" data-act="to-tonight">${T.profile.next}</button>
      </div>`;
  }

  function tonightScreen() {
    const noLimit = d.maxMinutes === undefined;
    return `
      <h2>${T.tonight.heading}</h2>
      <p class="q">${T.tonight.company}</p>
      <div class="chips">
        ${(Object.keys(T.tonight.companies) as Company[]).map((c) => chip(d.company === c, `data-company="${c}"`, T.tonight.companies[c])).join("")}
      </div>
      <div class="youngest"${shared(d.company) ? "" : " hidden"}>
        <label class="q" for="f-young">${T.tonight.youngest}: <b id="v-young"></b></label>
        <input id="f-young" type="range" min="1" max="18" value="${Math.min(d.youngestAge, 18)}" />
      </div>
      <label class="q" for="f-time">${T.tonight.time} <b id="v-time"></b></label>
      <input id="f-time" type="range" min="60" max="180" step="10" value="${d.maxMinutes ?? 120}"${noLimit ? " disabled" : ""} />
      <label class="check"><input id="f-nolimit" type="checkbox"${noLimit ? " checked" : ""} /> ${T.tonight.noLimit}</label>
      <p class="q">${T.tonight.avoid}</p>
      <div class="chips">${GENRES.map((g) => chip(d.avoidGenres.includes(g), `data-avoid="${g}"`, g)).join("")}</div>
      <p class="warn" id="f-error">${esc(error)}</p>
      <div class="row">
        <button type="button" data-act="to-profile">${T.back}</button>
        <button type="button" class="primary go" data-act="go">${T.tonight.go}</button>
      </div>`;
  }

  /** Labels that follow the sliders, and the state of "Let's go". */
  function refresh() {
    const set = (id: string, text: string) => {
      const el = root.querySelector(`#${id}`);
      if (el) el.textContent = text;
    };
    set("v-young", `${T.tonight.age(d.youngestAge)} → ${T.tonight.rating(certificationFor(d.youngestAge))}`);
    set("v-time", d.maxMinutes === undefined ? "" : `(${T.tonight.minutes(d.maxMinutes)})`);
    const goBtn = root.querySelector<HTMLButtonElement>("[data-act=go]");
    if (goBtn) {
      const why = !d.company ? T.tonight.pickCompany : opts.blocked();
      goBtn.disabled = why !== null;
      goBtn.textContent = why ?? T.tonight.go;
    }
  }

  function submit() {
    const raw = toRaw(d);
    try {
      const intake = parseIntake(raw);
      console.info("[intake]", JSON.stringify(raw));
      save(intake);
      opts.onDone(intake);
    } catch (e) {
      error = (e as Error).message;
      render();
    }
  }

  const acts: Record<string, () => void> = {
    "name-next": () => {
      const name = root.querySelector<HTMLInputElement>("#f-name")!.value.trim();
      if (!name) return root.querySelector<HTMLInputElement>("#f-name")!.focus();
      const saved = savedFor(name);
      d = saved ? draftFrom(saved) : freshDraft();
      d.name = name; // the spelling typed today wins
      retryFailed();
      go(saved ? "welcome" : "profile");
    },
    guest: () => {
      d = freshDraft();
      retryFailed();
      go("profile");
    },
    "use-saved": () => go("tonight"),
    "change-saved": () => {
      retryFailed();
      go("profile");
    },
    "not-me": () => {
      d = freshDraft();
      go("name");
    },
    "to-name": () => go("name"),
    "to-profile": () => {
      retryFailed();
      go("profile");
    },
    "to-tonight": () => go("tonight"),
    "no-stream": () => {
      d.noStream = !d.noStream;
      render();
    },
    go: submit,
  };

  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!b || (b as HTMLButtonElement).disabled) return;
    const { act, platform, company, avoid } = b.dataset;
    if (act) return acts[act]?.();
    if (platform) {
      const id = Number(platform);
      d.platforms = d.platforms.includes(id) ? d.platforms.filter((x) => x !== id) : [...d.platforms, id];
    }
    if (company) d.company = company as Company;
    if (avoid) d.avoidGenres = d.avoidGenres.includes(avoid) ? d.avoidGenres.filter((g) => g !== avoid) : [...d.avoidGenres, avoid];
    render();
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).id === "f-name") acts["name-next"]();
  });

  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "f-age") {
      d.age = Number(t.value);
      root.querySelector("#v-age")!.textContent = t.value;
    }
    if (t.id === "f-young") d.youngestAge = Number(t.value);
    if (t.id === "f-time") d.maxMinutes = Number(t.value);
    refresh();
  });

  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "f-country") {
      d.country = t.value;
      // Keep only the platforms the new country has, once its list is known.
      loadProviders(d.country, [], () => {
        const p = providers.get(d.country);
        if (p?.state === "ok") d.platforms = d.platforms.filter((id) => p.value.some((x) => x.id === id));
        render();
      });
      render();
    }
    if (t.id === "f-nolimit") {
      d.maxMinutes = t.checked ? undefined : 120;
      render();
    }
  });

  return {
    open(s) {
      if (s === "name") d = freshDraft();
      go(s);
    },
    refresh,
  };
}
