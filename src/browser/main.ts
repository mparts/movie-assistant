/** The page: the settings form (Phase 1), then the spoken chat with Elisa (Phase 2). */
import "./style.css";
import { formText as T, movieCardText } from "../config/prompts";
import { certificationFor } from "../core/intake";
import { dmActor, onChange, speechView } from "./dm";
import { createIntakeForm } from "./intakeForm";

document.querySelector("#app")!.innerHTML = `
  <header><span class="title">${T.title}</span><span class="tagline">${T.tagline}</span></header>
  <main>
    <section id="form" class="panel"></section>
    <section id="pool-check" class="panel" hidden>
      <p class="q" id="pool-message"></p>
      <div class="row">
        <button type="button" id="pool-change">${T.pool.change}</button>
        <button type="button" class="primary" id="pool-go">${T.pool.goAnyway}</button>
      </div>
    </section>
    <section id="chat" class="panel" hidden>
      <div id="tonight-summary" class="summary"></div>
      <div class="line elisa"><span class="who">${T.chat.elisa}</span><p id="elisa-said">…</p></div>
      <div id="movie-card" hidden>
        <img id="movie-poster" alt="" />
        <div class="info"><div id="movie-title"></div><div id="movie-director"></div><div id="movie-cast"></div><div id="movie-runtime"></div></div>
      </div>
      <div class="line you"><span class="who">${T.chat.you}</span><p id="you-said"></p></div>
      <div id="status-strip"><div id="status-dot"></div><div id="status-text"></div></div>
      <button type="button" id="change">${T.chat.change}</button>
    </section>
  </main>`;

const NO_POSTER = "/no-poster.png";
const $ = (id: string) => document.getElementById(id)!;

/** Why a new conversation cannot start right now, or null. */
function blocked(): string | null {
  const view = speechView();
  if (view === "error" || view === "stopped") return T.waiting.broken;
  if (dmActor.getSnapshot().matches("FindingMovies")) return T.pool.finding;
  if (!dmActor.getSnapshot().matches("Intake")) return T.waiting.notReady;
  return view === "idle" ? null : T.waiting.busy;
}

const form = createIntakeForm($("form"), { blocked, onDone: (intake) => dmActor.send({ type: "INTAKE_DONE", intake }) });
form.open("name");

/** Back to the Tonight screen with the answers kept: from the chat, or when there are too few movies. */
const changeSettings = () => {
  dmActor.send({ type: "CHANGE_SETTINGS" });
  form.open("tonight");
};
$("change").addEventListener("click", changeSettings);
$("pool-change").addEventListener("click", changeSettings);
$("pool-go").addEventListener("click", () => dmActor.send({ type: "GO_ANYWAY" }));

onChange(() => {
  const snap = dmActor.getSnapshot();
  const chatting = snap.matches("Main");
  const checking = snap.matches("PoolCheck");
  $("chat").hidden = !chatting;
  $("form").hidden = chatting || checking;
  $("pool-check").hidden = !checking;
  if (checking) {
    const { pool, poolError } = snap.context;
    const n = pool?.movies.length ?? 0;
    $("pool-message").textContent = poolError ? T.pool.failed(poolError) : n ? T.pool.small(n) : T.pool.empty;
    ($("pool-go") as HTMLButtonElement).hidden = !n;
  }
  form.refresh();
  if (!chatting) return;

  const { is, elisaSaid, lastUtterance, suggested } = snap.context;
  $("movie-card").hidden = !suggested;
  if (suggested) {
    const C = movieCardText;
    const poster = $("movie-poster") as HTMLImageElement;
    const src = suggested.posterPath ? `https://image.tmdb.org/t/p/w342${suggested.posterPath}` : NO_POSTER;
    if (poster.getAttribute("src") !== src) poster.src = src;
    poster.onerror = () => { if (!poster.src.endsWith(NO_POSTER)) poster.src = NO_POSTER; };
    $("movie-title").textContent = suggested.year ? `${suggested.title} (${suggested.year})` : suggested.title;
    $("movie-director").textContent = suggested.directors?.length ? `${C.director} ${suggested.directors.join(", ")}` : "";
    $("movie-cast").textContent = suggested.cast?.length ? `${C.cast} ${suggested.cast.slice(0, 3).join(", ")}` : "";
    $("movie-runtime").textContent = suggested.runtime ? C.minutes(suggested.runtime) : "";
  }
  if (is) {
    const { profile, tonight } = is.intake;
    $("tonight-summary").textContent = [
      profile.name ?? "Guest",
      T.tonight.companies[tonight.company],
      T.tonight.rating(certificationFor(tonight.youngestAge)),
      tonight.maxMinutes ? T.tonight.minutes(tonight.maxMinutes) : T.tonight.noLimit,
    ].join(" · ");
  }
  $("elisa-said").textContent = elisaSaid ?? "…";
  $("you-said").textContent = lastUtterance ?? "";
  const view = speechView();
  $("status-dot").className = view;
  $("status-text").textContent = T.chat.status[view] ?? view;
});
