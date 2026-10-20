import "./style.css";
import { along, ease, draw, hitMarker, toPixel, type Layout, type Marker } from "./pitch";
import type { CopyBlock, Frame, Mode, ModePack, Timeline, TraceFile, TraceMessage, XY } from "./types";

const PLAY_MS = 3400;
const REVEAL_MS = 2400;

const NEUTRAL: Record<Mode, string> = {
  casual: "Calder has the ball outside the box.",
  analyst: "One frame. Three actions.",
  zh: "卡尔德在禁区前拿球。",
};

const NAMES: Record<string, string> = {
  ingest: "Ingest",
  analyst: "Analyst",
  director: "Director",
  qa: "QA",
  overlay: "Overlay",
  personalize: "Personalize",
  broadcast: "Broadcast",
};

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const base = import.meta.env.BASE_URL;

const canvas = document.querySelector<HTMLCanvasElement>("#pitch");
const chipLayer = document.querySelector<HTMLElement>("#chips");
const clock = document.querySelector<HTMLElement>("#clock");
const prompt = document.querySelector<HTMLElement>("#prompt");
const choices = document.querySelector<HTMLElement>("#choices");
const verdict = document.querySelector<HTMLElement>("#verdict");
const playButton = document.querySelector<HTMLButtonElement>("#play");
const replayButton = document.querySelector<HTMLButtonElement>("#replay");
const traceDialog = document.querySelector<HTMLDialogElement>("#trace");
const traceList = document.querySelector<HTMLElement>("#trace-list");
const rejectLine = document.querySelector<HTMLElement>("#reject-line");
const stage = document.querySelector<HTMLElement>("#stage");
const futureNodes = {
  taken: document.querySelector<HTMLElement>('[data-slot="taken"]'),
  pass: document.querySelector<HTMLElement>('[data-slot="pass"]'),
  shot: document.querySelector<HTMLElement>('[data-slot="shot"]'),
};

let timeline: Timeline | null = null;
let mode: Mode = "casual";
let phase: "idle" | "play" | "guess" | "reveal" | "done" = "idle";
let choiceId: string | null = null;
let hoverId: string | null = null;
let raf = 0;
let startedAt = 0;
let revealed = false;
let lastLayout: Layout | null = null;
let viewIndex = 0;
let viewProgress = 0;

document.documentElement.classList.add("js");

function copy(): CopyBlock | null {
  return timeline ? timeline.copy[mode] : null;
}

function clockText(matchT: number): string {
  const whole = Math.max(0, Math.floor(matchT));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds < 10 ? `0${seconds}` : String(seconds)}`;
}

function frameAt(index: number): Frame {
  if (!timeline) throw new Error("no timeline");
  const frames = timeline.frames;
  const i = Math.max(0, Math.min(frames.length - 1, Math.floor(index)));
  const j = Math.min(frames.length - 1, i + 1);
  const u = Math.min(1, Math.max(0, index - i));
  const a = frames[i];
  const b = frames[j];
  if (u === 0 || i === j) return a;
  return {
    index: i,
    t: a.t + (b.t - a.t) * u,
    match_t: a.match_t + (b.match_t - a.match_t) * u,
    source: a.source,
    ball: {
      x: a.ball.x + (b.ball.x - a.ball.x) * u,
      y: a.ball.y + (b.ball.y - a.ball.y) * u,
    },
    players: a.players.map((player, n) => {
      const other = b.players[n] ?? player;
      return {
        ...player,
        x: player.x + (other.x - player.x) * u,
        y: player.y + (other.y - player.y) * u,
      };
    }),
  };
}

function startIndex(): number {
  if (!timeline) return 0;
  return Math.max(0, timeline.decision_frame - 80);
}

function endIndex(): number {
  if (!timeline) return 0;
  return Math.min(timeline.frames.length - 1, timeline.decision_frame + 48);
}

function trailUntil(index: number): XY[] {
  if (!timeline) return [];
  const from = startIndex();
  const end = Math.max(from, Math.min(timeline.frames.length - 1, Math.ceil(index)));
  const points: XY[] = [];
  for (let i = from; i <= end; i += 1) points.push(timeline.frames[i].ball);
  const frame = frameAt(index);
  const last = points[points.length - 1];
  if (!last || last.x !== frame.ball.x || last.y !== frame.ball.y) points.push(frame.ball);
  return points;
}

function markers(): Marker[] {
  if (!timeline || (phase !== "guess" && phase !== "reveal" && phase !== "done")) return [];
  return timeline.quiz.options.map((option) => ({
    id: option.id,
    at: option.end,
    hot: option.id === hoverId || option.id === choiceId,
  }));
}

function paint(index: number, progress: number): void {
  if (!timeline || !canvas || !chipLayer) return;
  viewIndex = index;
  viewProgress = progress;
  const showGhosts = (phase === "reveal" || phase === "done") && progress > 0;
  const frame = frameAt(index);
  lastLayout = draw(canvas, {
    frame,
    trail: trailUntil(index),
    ghosts: timeline.ghosts,
    progress,
    markers: markers(),
    home: timeline.match.home.color,
    away: timeline.match.away.color,
    actorId: timeline.taken.player_id,
    showGhosts,
  });
  if (clock) {
    const { home, away, score } = timeline.match;
    clock.textContent = `${home.short} ${score.home}–${score.away} ${away.short}  ${clockText(frame.match_t)}`;
  }
  chipLayer.replaceChildren();
  if (!showGhosts) return;
  timeline.ghosts.forEach((ghost, index) => {
    const point = along(ghost, ease(Math.min(1, Math.max(0.02, progress))));
    placeChip(point, ghost.label.text, ghost.label.source, index * 26, ghost.kind === "shot" ? "xG" : "EV", true);
  });
  placeChip(frame.ball, timeline.taken.label_text, timeline.taken.source ?? "model_estimate", -8, "Played EV", false);
}

function placeChip(at: XY, text: string, source: string, nudge: number, tag: string, ghost: boolean): void {
  if (!chipLayer || !lastLayout) return;
  const pixel = toPixel(lastLayout, at.x, at.y);
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.dataset.source = source;
  chip.dataset.ghost = String(ghost);
  const value = document.createElement("b");
  value.textContent = text;
  const small = document.createElement("small");
  small.textContent = tag;
  chip.append(small, value);
  chip.style.left = `${(pixel.px / lastLayout.cssWidth) * 100}%`;
  chip.style.top = `${(pixel.py / lastLayout.cssHeight) * 100}%`;
  chip.style.transform = `translate(8px, calc(-130% + ${nudge}px))`;
  chipLayer.appendChild(chip);
}

function stop(): void {
  cancelAnimationFrame(raf);
}

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.hidden = hidden;
}

function renderChoices(): void {
  if (!choices || !timeline) return;
  const block = copy();
  choices.replaceChildren();
  for (const option of timeline.quiz.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice";
    button.dataset.id = option.id;
    button.textContent = block?.options[option.id] ?? option.id;
    if (revealed && option.id === timeline.quiz.correct_id) button.dataset.result = "played";
    else if (revealed && option.id === choiceId) button.dataset.result = "picked";
    else if (revealed) button.dataset.result = "other";
    if (choiceId === option.id) button.setAttribute("aria-pressed", "true");
    button.disabled = revealed;
    button.addEventListener("click", () => choose(option.id));
    button.addEventListener("pointerenter", () => {
      hoverId = option.id;
      hold();
    });
    button.addEventListener("pointerleave", () => {
      hoverId = null;
      hold();
    });
    choices.appendChild(button);
  }
}

function renderWords(): void {
  const block = copy();
  if (!block || !timeline) return;
  const lead = document.querySelector(".lead");
  if (lead) lead.textContent = revealed ? block.caption : NEUTRAL[mode];
  if (prompt) prompt.textContent = block.quiz_prompt;
  setHidden(prompt, phase !== "guess");
  setHidden(choices, phase === "idle" || phase === "play");
  if (verdict) {
    if (!revealed || !choiceId) {
      verdict.textContent = "";
      setHidden(verdict, true);
    } else {
      const right = choiceId === timeline.quiz.correct_id;
      verdict.textContent = `${right ? block.verdict_right : block.verdict_wrong} ${block.reveal}`;
      setHidden(verdict, false);
    }
  }
  stage?.classList.toggle("is-guess", phase === "guess");
  const pass = timeline.alternatives.find((item) => item.kind === "pass");
  const shot = timeline.alternatives.find((item) => item.kind === "shot");
  const rows: Array<[HTMLElement | null, string | undefined]> = [
    [futureNodes.taken, timeline.taken.id],
    [futureNodes.pass, pass?.id],
    [futureNodes.shot, shot?.id],
  ];
  for (const [node, id] of rows) {
    if (!node || !id) continue;
    const title = node.querySelector("h3");
    if (title) title.textContent = block.options[id] ?? id;
    node.classList.toggle("played", revealed && id === timeline.quiz.correct_id);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-en]")) {
    const text = mode === "zh" ? button.dataset.zh : button.dataset.en;
    if (text) button.textContent = text;
  }
}

function hold(): void {
  if (!timeline || phase === "play" || phase === "reveal") return;
  paint(phase === "done" ? endIndex() : viewIndex, phase === "done" ? 1 : viewProgress);
}

function choose(id: string): void {
  if (!timeline || phase !== "guess" || choiceId) return;
  choiceId = id;
  revealed = true;
  phase = reduced ? "done" : "reveal";
  renderWords();
  renderChoices();
  if (reduced) {
    paint(endIndex(), 1);
    return;
  }
  startedAt = performance.now();
  stop();
  raf = requestAnimationFrame(loop);
}

function loop(now: number): void {
  if (!timeline) return;
  if (phase === "play") {
    const u = Math.min(1, (now - startedAt) / PLAY_MS);
    const index = startIndex() + (timeline.decision_frame - startIndex()) * u;
    paint(index, 0);
    if (u >= 1) {
      phase = "guess";
      renderWords();
      renderChoices();
      paint(timeline.decision_frame, 0);
      return;
    }
  } else if (phase === "reveal") {
    const u = Math.min(1, (now - startedAt) / REVEAL_MS);
    const index = timeline.decision_frame + (endIndex() - timeline.decision_frame) * u;
    paint(index, Math.max(0.04, u));
    if (u >= 1) {
      phase = "done";
      paint(endIndex(), 1);
      renderWords();
    }
  } else if (phase === "done" && !reduced) {
    paint(endIndex(), 1);
  } else {
    return;
  }
  raf = requestAnimationFrame(loop);
}

function play(): void {
  if (!timeline) return;
  stop();
  choiceId = null;
  hoverId = null;
  revealed = false;
  renderChoices();
  if (reduced) {
    phase = "guess";
    renderWords();
    paint(timeline.decision_frame, 0);
    return;
  }
  phase = "play";
  renderWords();
  startedAt = performance.now();
  raf = requestAnimationFrame(loop);
}

function messageText(message: TraceMessage): string {
  if (message.intent === "qa_reject") {
    return (message.payload.reasons ?? []).join(" ") || "Rejected.";
  }
  if (message.intent === "qa_pass") return "Every number in the line is in the cited evidence.";
  if (message.intent === "moment_submitted") {
    const attempt = message.payload.attempt ?? 1;
    return attempt > 1 ? "Resubmitted without the figure QA refused." : "First caption, with a figure the evidence does not hold.";
  }
  if (message.intent === "analysis_reconfirmed") return "Decision frame scored again. The figures did not move.";
  if (message.intent === "analysis_ready") return message.payload.note || "Shot and pass values are ready.";
  if (message.intent === "match_ready") return "Synthetic tracking for the minute is in.";
  if (message.intent === "timeline_ready") return "Ghost trails and probability labels are timed.";
  if (message.intent === "modes_ready") return "Casual, analyst, and Chinese lines are ready.";
  return message.payload.note || message.payload.ask || message.intent;
}

function renderTrace(messages: TraceMessage[]): void {
  if (!traceList) return;
  traceList.replaceChildren();
  for (const message of messages) {
    const retry = message.intent === "analysis_reconfirmed"
      || (message.intent === "moment_submitted" && (message.payload.attempt ?? 1) > 1);
    const rejected = message.intent === "qa_reject";
    const block = document.createElement("article");
    block.className = rejected ? "msg sent-back" : retry ? "msg retry" : "msg";
    const who = document.createElement("p");
    who.className = "who";
    const from = NAMES[message.sender] ?? message.sender;
    const to = NAMES[message.receiver] ?? message.receiver;
    const tag = rejected ? "Sent back" : retry ? "Retry" : "";
    who.textContent = tag ? `${from} to ${to}. ${tag}` : `${from} to ${to}`;
    const what = document.createElement("p");
    what.textContent = messageText(message);
    block.append(who, what);
    traceList.appendChild(block);
  }
}

function renderLegend(): void {
  const legend = document.querySelector("#legend");
  if (!legend || !timeline) return;
  legend.replaceChildren();
  for (const item of timeline.legend) {
    const span = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = "swatch";
    swatch.dataset.source = item.source;
    span.append(swatch, document.createTextNode(item.label));
    legend.append(span);
  }
}

function applyPack(next: Mode, pack: ModePack): void {
  if (!timeline || !pack.moment?.caption || !pack.quiz?.prompt) return;
  const options: Record<string, string> = { ...timeline.copy[next].options };
  for (const option of pack.quiz.options ?? []) {
    if (option.label) options[option.id] = option.label;
  }
  timeline.copy[next] = {
    caption: pack.moment.caption,
    reveal: pack.moment.reveal ?? "",
    quiz_prompt: pack.quiz.prompt,
    verdict_right: pack.quiz.verdict_right ?? "",
    verdict_wrong: pack.quiz.verdict_wrong ?? "",
    options,
  };
  if (pack.legend?.length) timeline.legend = pack.legend;
}

function setMode(next: Mode): void {
  mode = next;
  document.documentElement.lang = next === "zh" ? "zh-Hans" : "en";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.setAttribute("aria-pressed", button.dataset.mode === next ? "true" : "false");
  }
  renderWords();
  renderChoices();
  if (phase === "done" || phase === "guess") hold();
}

function bindModes(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.addEventListener("click", () => {
      const next = button.dataset.mode;
      if (next === "casual" || next === "analyst" || next === "zh") setMode(next);
    });
  }
}

function openTrace(): void {
  traceDialog?.showModal();
  for (const button of document.querySelectorAll("[data-open-trace]")) {
    button.setAttribute("aria-expanded", "true");
  }
}

function pointOnCanvas(event: MouseEvent): { x: number; y: number } | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

async function load(): Promise<void> {
  const [timelineRes, traceRes, casualRes, analystRes, zhRes] = await Promise.all([
    fetch(`${base}data/timeline.json`),
    fetch(`${base}data/trace.json`),
    fetch(`${base}data/casual.json`),
    fetch(`${base}data/analyst.json`),
    fetch(`${base}data/zh.json`),
  ]);
  if (!timelineRes.ok) throw new Error("timeline");
  timeline = (await timelineRes.json()) as Timeline;
  const packs: Array<[Mode, Response]> = [
    ["casual", casualRes],
    ["analyst", analystRes],
    ["zh", zhRes],
  ];
  for (const [name, res] of packs) {
    if (res.ok) applyPack(name, (await res.json()) as ModePack);
  }
  if (traceRes.ok) {
    const trace = (await traceRes.json()) as TraceFile;
    renderTrace(trace.messages);
    const reject = trace.messages.find((item) => item.intent === "qa_reject");
    if (rejectLine && reject?.payload.reasons?.[0]) {
      rejectLine.textContent = `QA sent it back: ${reject.payload.reasons[0]}. The analyst recomputed the frame and the director wrote the line again.`;
    }
  }
  const note = document.querySelector("#note");
  if (note && timeline.match.note) note.textContent = timeline.match.note;
  renderLegend();
  renderChoices();
  renderWords();
  paint(reduced ? timeline.decision_frame : startIndex(), 0);
  if (reduced) {
    phase = "guess";
    renderWords();
    paint(timeline.decision_frame, 0);
  } else {
    play();
  }
}

playButton?.addEventListener("click", () => play());
replayButton?.addEventListener("click", () => {
  document.querySelector("#second")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  play();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open-trace]")) {
  button.addEventListener("click", openTrace);
}
document.querySelector("#close-trace")?.addEventListener("click", () => traceDialog?.close());
traceDialog?.addEventListener("close", () => {
  for (const button of document.querySelectorAll("[data-open-trace]")) {
    button.setAttribute("aria-expanded", "false");
  }
});
canvas?.addEventListener("click", (event) => {
  if (phase !== "guess" || !lastLayout) return;
  const point = pointOnCanvas(event);
  if (!point) return;
  const id = hitMarker(lastLayout, markers(), point.x, point.y);
  if (id) choose(id);
});
canvas?.addEventListener("pointermove", (event) => {
  if (phase !== "guess" || !lastLayout) return;
  const point = pointOnCanvas(event);
  if (!point) return;
  const id = hitMarker(lastLayout, markers(), point.x, point.y);
  if (id === hoverId) return;
  hoverId = id;
  hold();
});
window.addEventListener("resize", () => {
  if (phase === "play" || phase === "reveal") return;
  hold();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stop();
    return;
  }
  if ((phase === "done" || phase === "play" || phase === "reveal") && !reduced) {
    raf = requestAnimationFrame(loop);
  }
});
bindModes();

void load().catch(() => {
  const lead = document.querySelector(".lead");
  if (lead) lead.textContent = "The replay file did not load.";
});
