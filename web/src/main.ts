import "./style.css";
import { along, draw, hitMarker, toPixel } from "./pitch";
import type { CopyBlock, Frame, Mode, Timeline, TraceFile, TraceMessage } from "./types";

const PLAY_MS = 3400;
const REVEAL_MS = 2200;

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
const traceButton = document.querySelector<HTMLButtonElement>("#open-trace");
const traceDialog = document.querySelector<HTMLDialogElement>("#trace");
const traceList = document.querySelector<HTMLElement>("#trace-list");
const rejectLine = document.querySelector<HTMLElement>("#reject-line");
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

function copy(): CopyBlock | null {
  return timeline ? timeline.copy[mode] : null;
}

function clockText(matchT: number): string {
  const whole = Math.max(0, Math.floor(matchT));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  const sec = seconds < 10 ? `0${seconds}` : String(seconds);
  return `${minutes}:${sec}`;
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
  const showGhosts = (phase === "reveal" || phase === "done") && progress > 0;
  const layout = draw(canvas, {
    frame: frameAt(index),
    ghosts: timeline.ghosts,
    progress,
    markers: markers(),
    home: timeline.match.home.color,
    away: timeline.match.away.color,
    actorId: timeline.taken.player_id,
    showGhosts,
  });
  if (clock) {
    const venue = timeline.match.venue;
    clock.textContent = `${venue}, ${clockText(frameAt(index).match_t)}`;
  }
  chipLayer.replaceChildren();
  if (!showGhosts) return;
  for (const ghost of timeline.ghosts) {
    const point = along(ghost, progress);
    const pixel = toPixel(layout, point.x, point.y);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.source = ghost.label.source;
    chip.textContent = ghost.label.text;
    chip.style.left = `${(pixel.px / layout.cssWidth) * 100}%`;
    chip.style.top = `${(pixel.py / layout.cssHeight) * 100}%`;
    chipLayer.appendChild(chip);
  }
}

function startIndex(): number {
  if (!timeline) return 0;
  return Math.max(0, timeline.decision_frame - 80);
}

function endIndex(): number {
  if (!timeline) return 0;
  return Math.min(timeline.frames.length - 1, timeline.decision_frame + 48);
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
    else if (revealed) button.dataset.result = "other";
    if (choiceId === option.id) button.setAttribute("aria-pressed", "true");
    button.addEventListener("click", () => choose(option.id));
    button.addEventListener("pointerenter", () => {
      hoverId = option.id;
      holdGuess();
    });
    button.addEventListener("pointerleave", () => {
      hoverId = null;
      holdGuess();
    });
    choices.appendChild(button);
  }
}

function renderWords(): void {
  const block = copy();
  if (!block || !timeline) return;
  if (prompt) prompt.textContent = phase === "guess" ? block.quiz_prompt : "";
  setHidden(prompt, phase !== "guess");
  setHidden(choices, phase === "idle" || phase === "play");
  if (verdict) {
    if (!revealed || !choiceId) {
      verdict.textContent = "";
      setHidden(verdict, true);
    } else {
      verdict.textContent = choiceId === timeline.quiz.correct_id ? block.verdict_right : block.verdict_wrong;
      setHidden(verdict, false);
    }
  }
  const taken = timeline.taken;
  const pass = timeline.alternatives.find((item) => item.kind === "pass");
  const shot = timeline.alternatives.find((item) => item.kind === "shot");
  const rows: Array<[HTMLElement | null, { id: string; label: string; detail: string } | null]> = [
    [futureNodes.taken, taken ? { id: taken.id, label: block.options[taken.id] ?? taken.label_text, detail: detail(taken.id, "The lane he can see.") } : null],
    [futureNodes.pass, pass ? { id: pass.id, label: block.options[pass.id] ?? pass.label_text, detail: detail(pass.id, "The run he does not use.") } : null],
    [futureNodes.shot, shot ? { id: shot.id, label: block.options[shot.id] ?? shot.label_text, detail: detail(shot.id, "The shot from where he stands.") } : null],
  ];
  for (const [node, row] of rows) {
    if (!node || !row) continue;
    const title = node.querySelector("h3");
    const body = node.querySelector("p");
    if (title) title.textContent = row.label;
    if (body) body.textContent = row.detail;
    node.classList.toggle("played", revealed && row.id === timeline.quiz.correct_id);
  }
}

function detail(id: string, plain: string): string {
  if (!timeline) return plain;
  if (mode === "casual" && !revealed) return plain;
  const option = [timeline.taken, ...timeline.alternatives].find((item) => item.id === id);
  if (!option) return plain;
  const source = "Model estimate";
  const played = revealed && id === timeline.quiz.correct_id ? " This one was played." : "";
  if (mode === "casual") return `${plain} ${source} ${option.label_text}.${played}`;
  return `${plain}${played}`;
}

function holdGuess(): void {
  if (!timeline || phase === "play" || phase === "reveal") return;
  const index = phase === "done" ? endIndex() : timeline.decision_frame;
  paint(index, phase === "done" ? 1 : 0);
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
      return;
    }
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

function renderTrace(messages: TraceMessage[]): void {
  if (!traceList) return;
  const name: Record<string, string> = {
    ingest: "Ingest",
    analyst: "Analyst",
    director: "Director",
    qa: "QA",
    overlay: "Overlay",
    personalize: "Personalize",
    broadcast: "Broadcast",
  };
  traceList.replaceChildren();
  for (const message of messages) {
    const block = document.createElement("article");
    block.className = message.intent === "qa_reject" ? "msg sent-back" : "msg";
    const who = document.createElement("p");
    who.className = "who";
    who.textContent = `${name[message.sender] ?? message.sender} to ${name[message.receiver] ?? message.receiver}`;
    const what = document.createElement("p");
    what.textContent = messageText(message);
    block.append(who, what);
    traceList.appendChild(block);
  }
}

function messageText(message: TraceMessage): string {
  if (message.intent === "qa_reject") {
    const reasons = (message.payload.reasons ?? []).join(" ");
    return reasons || "Rejected.";
  }
  if (message.intent === "qa_pass") return "Every number in the line is in the cited evidence.";
  if (message.intent === "moment_submitted") {
    const caption = message.payload.captions?.casual ?? "";
    return caption;
  }
  if (message.intent === "analysis_reconfirmed") return "The decision frame was scored again. The figures did not move.";
  if (message.intent === "analysis_ready") return "Shot and pass values are ready for the director.";
  if (message.intent === "match_ready") return "Synthetic tracking for the sixty-seventh minute is in.";
  if (message.intent === "timeline_ready") return "Ghost trails and probability labels are timed.";
  if (message.intent === "modes_ready") return "Casual, analyst, and Chinese lines are ready.";
  return message.payload.note || message.payload.ask || message.intent;
}

function setMode(next: Mode): void {
  mode = next;
  document.documentElement.lang = next === "zh" ? "zh-Hans" : "en";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.setAttribute("aria-pressed", button.dataset.mode === next ? "true" : "false");
  }
  renderWords();
  renderChoices();
}

function bindModes(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    button.addEventListener("click", () => {
      const next = button.dataset.mode;
      if (next === "casual" || next === "analyst" || next === "zh") setMode(next);
    });
  }
}

async function load(): Promise<void> {
  const [timelineRes, traceRes] = await Promise.all([
    fetch(`${base}data/timeline.json`),
    fetch(`${base}data/trace.json`),
  ]);
  if (!timelineRes.ok) throw new Error("timeline");
  timeline = (await timelineRes.json()) as Timeline;
  if (traceRes.ok) {
    const trace = (await traceRes.json()) as TraceFile;
    renderTrace(trace.messages);
    const reject = trace.messages.find((item) => item.intent === "qa_reject");
    if (rejectLine && reject?.payload.reasons?.length) {
      rejectLine.textContent = `QA sent it back: ${reject.payload.reasons[0]}. The analyst recomputed the frame and the director wrote the line again.`;
    }
  }
  renderChoices();
  renderWords();
  paint(reduced ? timeline.decision_frame : startIndex(), 0);
  if (canvas) {
    canvas.addEventListener("click", (event) => {
      if (phase !== "guess" || !timeline) return;
      const rect = canvas.getBoundingClientRect();
      const layout = draw(canvas, {
        frame: frameAt(timeline.decision_frame),
        ghosts: timeline.ghosts,
        progress: 0,
        markers: markers(),
        home: timeline.match.home.color,
        away: timeline.match.away.color,
        actorId: timeline.taken.player_id,
        showGhosts: false,
      });
      const id = hitMarker(layout, markers(), event.clientX - rect.left, event.clientY - rect.top);
      if (id) choose(id);
    });
  }
  window.addEventListener("resize", () => holdGuess());
  if (reduced) {
    phase = "guess";
    renderWords();
    paint(timeline.decision_frame, 0);
  } else {
    play();
  }
}

playButton?.addEventListener("click", () => {
  document.querySelector("#second")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  play();
});
replayButton?.addEventListener("click", () => {
  document.querySelector("#second")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  play();
});
traceButton?.addEventListener("click", () => traceDialog?.showModal());
bindModes();

void load().catch(() => {
  const lead = document.querySelector(".lead");
  if (lead) lead.textContent = "The replay file did not load. Build it with the seed, then open this page again.";
});
