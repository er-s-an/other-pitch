import type { Frame, FramePlayer, Ghost, XY } from "./types";

const LENGTH = 105;
const WIDTH = 68;
const GOAL_Y = 34;
const GOAL_HALF = 3.66;

/** Chalk for synthetic tracking. Teal for a model estimate. Matches the page tokens. */
const TRACK = "#f4efe4";
const ESTIMATE = "#146073";
const NIGHT = "#08110e";
const STRIPE_A = "#12392c";
const STRIPE_B = "#0e3026";

export interface Layout {
  scale: number;
  ox: number;
  oy: number;
  cssWidth: number;
  cssHeight: number;
}

export interface Marker {
  id: string;
  at: XY;
  hot: boolean;
}

export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/** Stagger each ghost so the trails draw on one after another, then meet at the end. */
export function ghostProgress(progress: number, index: number, count: number): number {
  if (progress >= 1) return 1;
  const lead = count > 1 ? index * 0.1 : 0;
  const u = (Math.min(1, Math.max(0, progress)) - lead) / (1 - lead);
  return easeOutCubic(Math.min(1, Math.max(0, u)));
}

export function layoutOf(cssWidth: number, cssHeight: number): Layout {
  const padX = 34;
  const padY = 22;
  const scale = Math.min(
    Math.max(1, cssWidth - padX * 2) / LENGTH,
    Math.max(1, cssHeight - padY * 2) / WIDTH,
  );
  const pw = LENGTH * scale;
  const ph = WIDTH * scale;
  return {
    scale,
    ox: (cssWidth - pw) / 2,
    oy: (cssHeight - ph) / 2,
    cssWidth,
    cssHeight,
  };
}

export function toPixel(layout: Layout, x: number, y: number): { px: number; py: number } {
  return { px: layout.ox + x * layout.scale, py: layout.oy + y * layout.scale };
}

export function along(ghost: Ghost, progress: number): XY {
  const points = ghost.points;
  const last = points[points.length - 1];
  if (!last) return { x: 0, y: 0 };
  if (progress >= 1) return { x: last.x, y: last.y };
  const scaled = Math.max(0, progress) * (points.length - 1);
  const index = Math.floor(scaled);
  const next = points[Math.min(index + 1, points.length - 1)];
  const current = points[index];
  const u = scaled - index;
  return {
    x: current.x + (next.x - current.x) * u,
    y: current.y + (next.y - current.y) * u,
  };
}

function sourceColor(source: string): string {
  return source === "model_estimate" ? ESTIMATE : TRACK;
}

let grain: HTMLCanvasElement | null = null;

function grassGrain(): HTMLCanvasElement {
  if (grain) return grain;
  const tile = document.createElement("canvas");
  tile.width = 128;
  tile.height = 128;
  const g = tile.getContext("2d");
  if (!g) return tile;
  const image = g.createImageData(128, 128);
  let seed = 0x1f7a8c;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 70 + next() * 90;
    image.data[i] = v;
    image.data[i + 1] = v + 8;
    image.data[i + 2] = v - 6;
    image.data[i + 3] = next() < 0.42 ? 36 : 0;
  }
  g.putImageData(image, 0, 0);
  grain = tile;
  return tile;
}

function pitchRect(ctx: CanvasRenderingContext2D, layout: Layout): void {
  ctx.beginPath();
  ctx.rect(layout.ox, layout.oy, LENGTH * layout.scale, WIDTH * layout.scale);
}

function stripes(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const bands = 16;
  ctx.save();
  pitchRect(ctx, layout);
  ctx.clip();
  for (let i = 0; i < bands; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? STRIPE_A : STRIPE_B;
    const x = layout.ox + (LENGTH * layout.scale * i) / bands;
    const w = LENGTH * layout.scale / bands + 0.6;
    ctx.fillRect(x, layout.oy, w, WIDTH * layout.scale);
  }
  const pattern = ctx.createPattern(grassGrain(), "repeat");
  if (pattern) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = pattern;
    ctx.fillRect(layout.ox, layout.oy, LENGTH * layout.scale, WIDTH * layout.scale);
  }
  ctx.restore();
}

function floodlight(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const cx = layout.ox + LENGTH * layout.scale * 0.5;
  const cy = layout.oy + WIDTH * layout.scale * 0.42;
  const radius = Math.max(LENGTH, WIDTH) * layout.scale * 0.72;
  const pool = ctx.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
  pool.addColorStop(0, "rgba(236, 232, 214, 0.16)");
  pool.addColorStop(0.42, "rgba(190, 206, 176, 0.05)");
  pool.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  pitchRect(ctx, layout);
  ctx.clip();
  ctx.fillStyle = pool;
  ctx.fillRect(layout.ox, layout.oy, LENGTH * layout.scale, WIDTH * layout.scale);
  ctx.restore();
}

function vignette(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const cx = layout.ox + (LENGTH * layout.scale) / 2;
  const cy = layout.oy + (WIDTH * layout.scale) / 2;
  const radius = Math.hypot(LENGTH * layout.scale, WIDTH * layout.scale) * 0.55;
  const shade = ctx.createRadialGradient(cx, cy, radius * 0.45, cx, cy, radius);
  shade.addColorStop(0, "rgba(5, 10, 8, 0)");
  shade.addColorStop(0.7, "rgba(5, 10, 8, 0.06)");
  shade.addColorStop(1, "rgba(5, 10, 8, 0.58)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, layout.cssWidth, layout.cssHeight);
}

function markings(ctx: CanvasRenderingContext2D, layout: Layout, color: string, width: number, shift: number): void {
  const arc = Math.acos(5.5 / 9.15);
  const boxW = 16.5;
  const boxH = 40.32;
  const sixW = 5.5;
  const sixH = 18.32;
  const boxY = GOAL_Y - boxH / 2;
  const sixY = GOAL_Y - sixH / 2;
  ctx.save();
  ctx.translate(layout.ox + shift, layout.oy + shift);
  ctx.scale(layout.scale, layout.scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.lineWidth = width / layout.scale;
  ctx.strokeRect(0, 0, LENGTH, WIDTH);
  ctx.beginPath();
  ctx.moveTo(LENGTH / 2, 0);
  ctx.lineTo(LENGTH / 2, WIDTH);
  ctx.moveTo(LENGTH / 2 + 9.15, GOAL_Y);
  ctx.arc(LENGTH / 2, GOAL_Y, 9.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeRect(0, boxY, boxW, boxH);
  ctx.strokeRect(LENGTH - boxW, boxY, boxW, boxH);
  ctx.strokeRect(0, sixY, sixW, sixH);
  ctx.strokeRect(LENGTH - sixW, sixY, sixW, sixH);
  ctx.beginPath();
  ctx.arc(11, GOAL_Y, 9.15, -arc, arc);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(LENGTH - 11, GOAL_Y, 9.15, Math.PI - arc, Math.PI + arc);
  ctx.stroke();
  for (const [x, y] of [[0, 0], [LENGTH, 0], [LENGTH, WIDTH], [0, WIDTH]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 1, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = (width + 0.4) / layout.scale;
  ctx.beginPath();
  ctx.moveTo(0, GOAL_Y - GOAL_HALF);
  ctx.lineTo(-1.6, GOAL_Y - GOAL_HALF);
  ctx.lineTo(-1.6, GOAL_Y + GOAL_HALF);
  ctx.lineTo(0, GOAL_Y + GOAL_HALF);
  ctx.moveTo(LENGTH, GOAL_Y - GOAL_HALF);
  ctx.lineTo(LENGTH + 1.6, GOAL_Y - GOAL_HALF);
  ctx.lineTo(LENGTH + 1.6, GOAL_Y + GOAL_HALF);
  ctx.lineTo(LENGTH, GOAL_Y + GOAL_HALF);
  ctx.stroke();
  for (const x of [11, LENGTH / 2, LENGTH - 11]) {
    ctx.beginPath();
    ctx.arc(x, GOAL_Y, 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function net(ctx: CanvasRenderingContext2D, layout: Layout, side: 1 | -1): void {
  const depth = 2.35;
  const mouth = GOAL_HALF;
  const goalX = side === 1 ? LENGTH : 0;
  ctx.save();
  ctx.translate(layout.ox, layout.oy);
  ctx.scale(layout.scale, layout.scale);
  ctx.strokeStyle = "rgba(244, 239, 228, 0.34)";
  ctx.lineWidth = 0.85 / layout.scale;
  ctx.beginPath();
  const back = goalX + side * depth;
  const topIn = GOAL_Y - mouth + 0.35;
  const botIn = GOAL_Y + mouth - 0.35;
  ctx.moveTo(goalX, GOAL_Y - mouth);
  ctx.lineTo(back, topIn);
  ctx.lineTo(back, botIn);
  ctx.lineTo(goalX, GOAL_Y + mouth);
  for (let i = 1; i <= 4; i += 1) {
    const y = GOAL_Y - mouth + (mouth * 2 * i) / 5;
    const y2 = topIn + ((botIn - topIn) * i) / 5;
    ctx.moveTo(goalX, y);
    ctx.lineTo(back, y2);
  }
  for (let i = 1; i <= 3; i += 1) {
    const x = goalX + side * ((depth * i) / 4);
    const t = i / 4;
    ctx.moveTo(x, GOAL_Y - mouth + 0.35 * t);
    ctx.lineTo(x, GOAL_Y + mouth - 0.35 * t);
  }
  ctx.stroke();
  ctx.restore();
}

function strokePoly(ctx: CanvasRenderingContext2D, layout: Layout, points: XY[]): void {
  ctx.beginPath();
  points.forEach((point, index) => {
    const { px, py } = toPixel(layout, point.x, point.y);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function traceUntil(points: Array<{ x: number; y: number }>, progress: number): XY[] {
  if (points.length === 0) return [];
  if (progress >= 1) return points.map((point) => ({ x: point.x, y: point.y }));
  const scaled = Math.max(0, progress) * (points.length - 1);
  const index = Math.min(points.length - 1, Math.floor(scaled));
  const current = points[index];
  const next = points[Math.min(index + 1, points.length - 1)];
  const u = scaled - index;
  const head = {
    x: current.x + (next.x - current.x) * u,
    y: current.y + (next.y - current.y) * u,
  };
  const out = points.slice(0, index + 1).map((point) => ({ x: point.x, y: point.y }));
  const last = out[out.length - 1];
  if (!last || last.x !== head.x || last.y !== head.y) out.push(head);
  return out;
}

function ballTrail(ctx: CanvasRenderingContext2D, layout: Layout, points: XY[]): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = TRACK;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = Math.max(6, layout.scale * 0.7);
  strokePoly(ctx, layout, points);
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(2.2, layout.scale * 0.26);
  for (let i = 1; i < points.length; i += 1) {
    const from = toPixel(layout, points[i - 1].x, points[i - 1].y);
    const to = toPixel(layout, points[i].x, points[i].y);
    ctx.beginPath();
    ctx.moveTo(from.px, from.py);
    ctx.lineTo(to.px, to.py);
    ctx.globalAlpha = 0.18 + 0.78 * (i / (points.length - 1));
    ctx.stroke();
  }
  ctx.restore();
}

function ghostPath(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  ghost: Ghost,
  progress: number,
  motion: boolean,
): void {
  const points = traceUntil(ghost.points, progress);
  if (points.length < 2) return;
  const color = sourceColor(ghost.source);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.34;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.lineWidth = 8;
  strokePoly(ctx, layout, points);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = ghost.source === "model_estimate" ? 0.95 : 0.9;
  ctx.lineWidth = 2.3;
  ctx.setLineDash(ghost.kind === "shot" ? [4, 7] : [10, 8]);
  if (motion) ctx.lineDashOffset = -performance.now() / 42;
  strokePoly(ctx, layout, points);
  ctx.restore();
}

function playerDot(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  player: FramePlayer,
  color: string,
  ink: string,
  actor: boolean,
): void {
  const { px, py } = toPixel(layout, player.x, player.y);
  const radius = Math.max(9, layout.scale * 1.15);
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.beginPath();
  ctx.ellipse(px, py + radius * 0.82, radius * 1.05, radius * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(px - radius, py + radius * 0.15, radius * 2, radius);
  ctx.restore();
  if (actor) {
    ctx.beginPath();
    ctx.arc(px, py, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = TRACK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(6, 10, 8, 0.55)";
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.max(11, Math.round(radius * 0.95))}px "Public Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(player.number), px, py + 0.5);
}

function groundShadow(ctx: CanvasRenderingContext2D, px: number, py: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fill();
}

function ball(ctx: CanvasRenderingContext2D, layout: Layout, x: number, y: number): void {
  const { px, py } = toPixel(layout, x, y);
  const radius = Math.max(5.5, layout.scale * 0.72);
  groundShadow(ctx, px + 1, py + radius * 0.85, radius * 0.95, radius * 0.36);
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = TRACK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px - radius * 0.2, py, radius * 0.62, 0.4, 2.4);
  ctx.moveTo(px + radius * 0.15, py - radius * 0.7);
  ctx.lineTo(px + radius * 0.55, py - radius * 0.15);
  ctx.strokeStyle = "#1a1c18";
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function ghostBall(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  x: number,
  y: number,
  color: string,
  progress: number,
  motion: boolean,
): void {
  const { px, py } = toPixel(layout, x, y);
  const radius = Math.max(7, layout.scale * 0.92);
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.setLineDash([3.2, 3.4]);
  ctx.lineDashOffset = motion ? -progress * 28 - performance.now() / 70 : 0;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
}

function markerRing(ctx: CanvasRenderingContext2D, layout: Layout, marker: Marker): void {
  const { px, py } = toPixel(layout, marker.at.x, marker.at.y);
  ctx.beginPath();
  ctx.arc(px, py, marker.hot ? 16 : 12, 0, Math.PI * 2);
  ctx.strokeStyle = marker.hot ? ESTIMATE : TRACK;
  ctx.lineWidth = marker.hot ? 2.6 : 1.7;
  ctx.stroke();
  if (marker.hot) {
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = ESTIMATE;
    ctx.fill();
  }
}

export function draw(canvas: HTMLCanvasElement, input: {
  frame: Frame;
  trail: XY[];
  ghosts: Ghost[];
  progress: number;
  markers: Marker[];
  home: string;
  away: string;
  actorId: string;
  showGhosts: boolean;
  motion: boolean;
}): Layout {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return layoutOf(cssWidth, cssHeight);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  const layout = layoutOf(cssWidth, cssHeight);
  stripes(ctx, layout);
  floodlight(ctx, layout);
  net(ctx, layout, -1);
  net(ctx, layout, 1);
  markings(ctx, layout, "rgba(4, 12, 8, 0.45)", 2.4, 1.15);
  markings(ctx, layout, "rgba(244, 239, 228, 0.94)", 1.55, 0);
  ballTrail(ctx, layout, input.trail);
  if (input.showGhosts) {
    input.ghosts.forEach((ghost, index) => {
      const local = ghostProgress(input.progress, index, input.ghosts.length);
      ghostPath(ctx, layout, ghost, local, input.motion);
    });
  }
  for (const marker of input.markers) markerRing(ctx, layout, marker);
  const players = [...input.frame.players].sort((a, b) => a.y - b.y);
  for (const player of players) {
    const home = player.team === "home";
    playerDot(
      ctx,
      layout,
      player,
      home ? input.home : input.away,
      home ? TRACK : "#141614",
      player.id === input.actorId,
    );
  }
  if (input.showGhosts) {
    input.ghosts.forEach((ghost, index) => {
      const local = ghostProgress(input.progress, index, input.ghosts.length);
      if (local <= 0.02) return;
      const at = along(ghost, local);
      ghostBall(ctx, layout, at.x, at.y, sourceColor(ghost.source), local, input.motion);
    });
  }
  ball(ctx, layout, input.frame.ball.x, input.frame.ball.y);
  vignette(ctx, layout);
  return layout;
}

export function hitMarker(layout: Layout, markers: Marker[], px: number, py: number): string | null {
  let best: { id: string; dist: number } | null = null;
  for (const marker of markers) {
    const at = toPixel(layout, marker.at.x, marker.at.y);
    const dist = Math.hypot(at.px - px, at.py - py);
    if (dist < 36 && (!best || dist < best.dist)) best = { id: marker.id, dist };
  }
  return best ? best.id : null;
}
