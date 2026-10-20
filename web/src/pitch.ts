import type { Frame, FramePlayer, Ghost, XY } from "./types";

const LENGTH = 105;
const WIDTH = 68;
const GOAL_Y = 34;
const GOAL_HALF = 3.66;

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

export function layoutOf(cssWidth: number, cssHeight: number): Layout {
  const padX = 28;
  const padY = 18;
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

function pitchLine(ctx: CanvasRenderingContext2D, layout: Layout, color: string): void {
  const { ox, oy, scale } = layout;
  const arc = Math.acos(5.5 / 9.15);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 / scale;
  ctx.lineJoin = "miter";
  ctx.strokeRect(0, 0, LENGTH, WIDTH);
  ctx.beginPath();
  ctx.moveTo(LENGTH / 2, 0);
  ctx.lineTo(LENGTH / 2, WIDTH);
  ctx.moveTo(LENGTH / 2 + 9.15, GOAL_Y);
  ctx.arc(LENGTH / 2, GOAL_Y, 9.15, 0, Math.PI * 2);
  const boxW = 16.5;
  const boxH = 40.32;
  const sixW = 5.5;
  const sixH = 18.32;
  const boxY = GOAL_Y - boxH / 2;
  const sixY = GOAL_Y - sixH / 2;
  ctx.strokeRect(0, boxY, boxW, boxH);
  ctx.strokeRect(LENGTH - boxW, boxY, boxW, boxH);
  ctx.strokeRect(0, sixY, sixW, sixH);
  ctx.strokeRect(LENGTH - sixW, sixY, sixW, sixH);
  ctx.moveTo(11, GOAL_Y);
  ctx.arc(11, GOAL_Y, 0.35, 0, Math.PI * 2);
  ctx.moveTo(LENGTH - 11, GOAL_Y);
  ctx.arc(LENGTH - 11, GOAL_Y, 0.35, 0, Math.PI * 2);
  ctx.moveTo(LENGTH / 2, GOAL_Y);
  ctx.arc(LENGTH / 2, GOAL_Y, 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(11, GOAL_Y, 9.15, -arc, arc);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(LENGTH - 11, GOAL_Y, 9.15, Math.PI - arc, Math.PI + arc);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(LENGTH, 0, 1, Math.PI / 2, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(LENGTH, WIDTH, 1, Math.PI, Math.PI * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, WIDTH, 1, -Math.PI / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function stripe(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const bands = 10;
  for (let i = 0; i < bands; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "#143828" : "#1b4632";
    const x = layout.ox + (LENGTH * layout.scale * i) / bands;
    const w = (LENGTH * layout.scale) / bands + 0.5;
    ctx.fillRect(x, layout.oy, w, WIDTH * layout.scale);
  }
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
  const radius = Math.max(8, layout.scale * 1.2);
  if (actor) {
    ctx.beginPath();
    ctx.arc(px, py, radius + 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#f3f0e7";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.max(10, Math.round(radius))}px "Public Sans", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(player.number), px, py + 0.5);
}

function ball(ctx: CanvasRenderingContext2D, layout: Layout, x: number, y: number): void {
  const { px, py } = toPixel(layout, x, y);
  const radius = Math.max(5, layout.scale * 0.78);
  ctx.beginPath();
  ctx.arc(px, py, radius + 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(18, 20, 16, 0.45)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#f3f0e7";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px - radius * 0.15, py, radius * 0.62, 0.5, 2.3);
  ctx.strokeStyle = "#121410";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function ballTrail(ctx: CanvasRenderingContext2D, layout: Layout, points: XY[]): void {
  if (points.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2.4, layout.scale * 0.28);
  for (let i = 1; i < points.length; i += 1) {
    const from = toPixel(layout, points[i - 1].x, points[i - 1].y);
    const to = toPixel(layout, points[i].x, points[i].y);
    ctx.beginPath();
    ctx.moveTo(from.px, from.py);
    ctx.lineTo(to.px, to.py);
    const alpha = 0.15 + 0.8 * (i / (points.length - 1));
    ctx.strokeStyle = `rgba(243, 240, 231, ${alpha.toFixed(3)})`;
    ctx.stroke();
  }
}

function ghostPath(ctx: CanvasRenderingContext2D, layout: Layout, ghost: Ghost, progress: number): void {
  const count = Math.max(2, Math.ceil(ghost.points.length * Math.min(1, Math.max(0.02, progress))));
  const ink = ghost.source === "model_estimate" ? "#256f82" : "#f3f0e7";
  ctx.beginPath();
  ghost.points.slice(0, count).forEach((point, index) => {
    const { px, py } = toPixel(layout, point.x, point.y);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.globalAlpha = ghost.source === "model_estimate" ? 0.92 : 0.82;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([8, 7]);
  ctx.lineDashOffset = -performance.now() / 28;
  ctx.stroke();
  ctx.restore();
}

function goalMouth(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const depth = 2.4;
  ctx.save();
  ctx.translate(layout.ox, layout.oy);
  ctx.scale(layout.scale, layout.scale);
  ctx.strokeStyle = "#efe8d6";
  ctx.lineWidth = 1.8 / layout.scale;
  ctx.strokeRect(LENGTH, GOAL_Y - GOAL_HALF, depth, GOAL_HALF * 2);
  ctx.strokeRect(-depth, GOAL_Y - GOAL_HALF, depth, GOAL_HALF * 2);
  ctx.restore();
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
  ctx.fillStyle = "#10140f";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  const layout = layoutOf(cssWidth, cssHeight);
  stripe(ctx, layout);
  pitchLine(ctx, layout, "rgba(239, 232, 214, 0.88)");
  goalMouth(ctx, layout);
  ballTrail(ctx, layout, input.trail);
  if (input.showGhosts) {
    for (const ghost of input.ghosts) ghostPath(ctx, layout, ghost, input.progress);
  }
  for (const marker of input.markers) {
    const { px, py } = toPixel(layout, marker.at.x, marker.at.y);
    ctx.beginPath();
    ctx.arc(px, py, marker.hot ? 16 : 12, 0, Math.PI * 2);
    ctx.strokeStyle = marker.hot ? "#3ec1c9" : "#f3f0e7";
    ctx.lineWidth = marker.hot ? 3 : 2;
    ctx.stroke();
  }
  for (const player of input.frame.players) {
    const home = player.team === "home";
    playerDot(
      ctx,
      layout,
      player,
      home ? input.home : input.away,
      home ? "#f3f0e7" : "#121410",
      player.id === input.actorId,
    );
  }
  ball(ctx, layout, input.frame.ball.x, input.frame.ball.y);
  return layout;
}

export function hitMarker(layout: Layout, markers: Marker[], px: number, py: number): string | null {
  let best: { id: string; dist: number } | null = null;
  for (const marker of markers) {
    const at = toPixel(layout, marker.at.x, marker.at.y);
    const dist = Math.hypot(at.px - px, at.py - py);
    if (dist < 32 && (!best || dist < best.dist)) best = { id: marker.id, dist };
  }
  return best ? best.id : null;
}
