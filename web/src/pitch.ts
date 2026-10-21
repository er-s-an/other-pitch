import type { Frame, PlayerInfo, XY } from "./types";

const L = 105, W = 68, GY = 34, GH = 3.66;
const LINE = "rgba(240, 236, 224, 0.82)";
export const YOU = "#F5C542";      // your choice: solid amber
export const OTHER = "#8FD3E8";    // other option / recorded: dashed ice blue
const HOME = "#2BB3C0", HOME_INK = "#04181b", AWAY = "#F2EEE3", AWAY_INK = "#1a1c18";

export interface Layout { s: number; ox: number; oy: number; w: number; h: number }

export const VIEW_X0 = 33; // show the attacking two-thirds; every scenario plays out here
export function layoutOf(w: number, h: number): Layout {
  const pad = Math.max(8, Math.min(22, w * 0.02));
  const span = L - VIEW_X0 + 4;
  const s = Math.min((w - pad * 2) / span, (h - pad * 2) / W);
  return { s, ox: w - pad - (L + 2) * s, oy: (h - W * s) / 2, w, h };
}
const px = (l: Layout, x: number, y: number) => [l.ox + x * l.s, l.oy + y * l.s] as const;

export function framesAt(frames: Frame[], t: number): Frame {
  if (!frames.length) throw new Error("no frames");
  if (t <= frames[0].t) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].t < t) i++;
  const a = frames[i], b = frames[i + 1], u = (t - a.t) / (b.t - a.t || 1);
  const lerp = (p: XY, q: XY): XY => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const p: Record<string, XY> = {};
  for (const id in a.p) p[id] = lerp(a.p[id], b.p[id] ?? a.p[id]);
  return { t, ball: lerp(a.ball, b.ball), p };
}

function field(ctx: CanvasRenderingContext2D, l: Layout) {
  ctx.fillStyle = "#0b1a14";
  ctx.fillRect(0, 0, l.w, l.h);
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 ? "#123a2b" : "#15402f";
    ctx.fillRect(l.ox + (L * l.s * i) / bands, l.oy, (L * l.s) / bands + 0.5, W * l.s);
  }
  const g = ctx.createRadialGradient(l.ox + L * l.s * 0.7, l.oy + W * l.s * 0.45, 10, l.ox + L * l.s * 0.6, l.oy + W * l.s * 0.5, L * l.s * 0.8);
  g.addColorStop(0, "rgba(255,250,225,0.10)");
  g.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = g;
  ctx.fillRect(l.ox, l.oy, L * l.s, W * l.s);
  ctx.save();
  ctx.translate(l.ox, l.oy);
  ctx.scale(l.s, l.s);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.6 / l.s;
  ctx.strokeRect(0, 0, L, W);
  ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.lineTo(L / 2, W); ctx.stroke();
  ctx.beginPath(); ctx.arc(L / 2, GY, 9.15, 0, Math.PI * 2); ctx.stroke();
  for (const side of [0, 1]) {
    const x0 = side ? L - 16.5 : 0, x1 = side ? L - 5.5 : 0;
    ctx.strokeRect(x0, GY - 20.16, 16.5, 40.32);
    ctx.strokeRect(x1, GY - 9.16, 5.5, 18.32);
    const a = Math.acos(5.5 / 9.15);
    ctx.beginPath();
    if (side) ctx.arc(L - 11, GY, 9.15, Math.PI - a, Math.PI + a); else ctx.arc(11, GY, 9.15, -a, a);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(side ? L - 11 : 11, GY, 0.3, 0, Math.PI * 2); ctx.fillStyle = LINE; ctx.fill();
    const gx = side ? L : 0, d = side ? 1.8 : -1.8;
    ctx.lineWidth = 2.4 / l.s;
    ctx.beginPath(); ctx.moveTo(gx, GY - GH); ctx.lineTo(gx + d, GY - GH); ctx.lineTo(gx + d, GY + GH); ctx.lineTo(gx, GY + GH); ctx.stroke();
    ctx.lineWidth = 1.6 / l.s;
  }
  ctx.restore();
  // attack direction cue
  const [ax, ay] = px(l, L - 30, 3.2);
  ctx.fillStyle = "rgba(240,236,224,0.55)";
  ctx.font = `600 ${Math.max(10, l.s * 1.35)}px "Public Sans", sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("ATTACKING  \u2192", ax, ay);
}

export interface Route { points: XY[]; color: string; dashed: boolean; label: string; progress?: number }
export interface Highlight { id: string; label: string; ghostFrom?: XY }

export interface DrawInput {
  frame: Frame; players: PlayerInfo[]; carrierId: string; routes: Route[]; targets?: Array<{ id: string; at: XY; label: string; hot: boolean; below?: boolean }>;
  highlights: Highlight[]; laneBand?: { from: XY; to: XY } | null; zones?: Array<{ at: XY; r: number }>; caption?: string;
}

function playerDisc(ctx: CanvasRenderingContext2D, l: Layout, info: PlayerInfo, at: XY, ring: string | null) {
  const [x, y] = px(l, at[0], at[1]);
  const r = Math.max(7.5, l.s * 1.05);
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = info.team === "home" ? HOME : AWAY; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.stroke();
  if (info.team === "away") { // away: square notch so teams differ by shape, not only colour
    ctx.fillStyle = "#c9463d"; ctx.fillRect(x - r * 0.55, y - r - 1, r * 1.1, r * 0.42);
  }
  if (ring) { ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, Math.PI * 2); ctx.strokeStyle = ring; ctx.lineWidth = 2.4; ctx.stroke(); }
  ctx.fillStyle = info.team === "home" ? HOME_INK : AWAY_INK;
  ctx.font = `700 ${Math.max(9, Math.round(r * 0.95))}px "Public Sans", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(info.number), x, y + 0.5);
}

function tag(ctx: CanvasRenderingContext2D, l: Layout, at: XY, text: string, color: string, below = false) {
  const [cx0, y0] = px(l, at[0], at[1]);
  const fs = Math.max(10, Math.min(13, l.s * 1.45));
  ctx.font = `600 ${fs}px "Public Sans", sans-serif`;
  const w = ctx.measureText(text).width + 12, h = fs + 9;
  const y = below ? y0 + l.s * 1.6 + 4 : y0 - l.s * 1.6 - h - 4;
  let x = cx0 - w / 2;
  x = Math.max(4, Math.min(l.w - w - 4, x));
  ctx.fillStyle = "rgba(6,12,10,0.86)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
  ctx.fillStyle = color; ctx.fillRect(x, y, 3, h);
  ctx.fillStyle = "#F3F0E7"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, x + 8, y + h / 2 + 0.5);
}

export function draw(canvas: HTMLCanvasElement, d: DrawInput) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const l = layoutOf(w, h);
  field(ctx, l);
  if (d.laneBand) {
    const [x1, y1] = px(l, ...d.laneBand.from), [x2, y2] = px(l, ...d.laneBand.to);
    ctx.save(); ctx.strokeStyle = "rgba(201,70,61,0.14)"; ctx.lineCap = "round"; ctx.lineWidth = l.s * 12;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }
  for (const z of d.zones ?? []) {
    const [x, y] = px(l, ...z.at);
    ctx.beginPath(); ctx.arc(x, y, z.r * l.s, 0, Math.PI * 2); ctx.fillStyle = "rgba(201,70,61,0.13)"; ctx.fill();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(201,70,61,0.6)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
  }
  for (const r of d.routes) {
    if (r.points.length < 2) continue;
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = r.color; ctx.lineWidth = r.dashed ? 2.2 : 3.4; ctx.globalAlpha = r.dashed ? 0.85 : 1;
    if (r.dashed) ctx.setLineDash([8, 7]);
    ctx.beginPath();
    r.points.forEach((p, i) => { const [x, y] = px(l, p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke(); ctx.restore();
  }
  for (const h of d.highlights) {
    if (h.ghostFrom) {
      const [gx, gy] = px(l, ...h.ghostFrom), now = d.frame.p[h.id];
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(242,238,227,0.6)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(7.5, l.s * 1.05), 0, Math.PI * 2); ctx.stroke();
      if (now) { const [nx, ny] = px(l, ...now); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(nx, ny); ctx.stroke(); }
      ctx.restore();
    }
  }
  for (const t of d.targets ?? []) {
    const [x, y] = px(l, ...t.at);
    ctx.beginPath(); ctx.arc(x, y, t.hot ? 15 : 12, 0, Math.PI * 2);
    ctx.strokeStyle = t.hot ? YOU : "rgba(245,197,66,0.75)"; ctx.lineWidth = t.hot ? 3 : 1.8; ctx.setLineDash(t.hot ? [] : [4, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = YOU; ctx.fill();
  }
  const ringFor = new Map(d.highlights.map((h) => [h.id, "#E8574C"]));
  ringFor.set(d.carrierId, "#F3F0E7");
  for (const info of d.players) {
    const at = d.frame.p[info.id];
    if (at) playerDisc(ctx, l, info, at, ringFor.get(info.id) ?? null);
  }
  // ball
  const [bx, by] = px(l, ...d.frame.ball), br = Math.max(4.5, l.s * 0.62);
  ctx.beginPath(); ctx.arc(bx, by, br + 2.5, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fill();
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fillStyle = "#FFFFFF"; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = "#0b0c0a"; ctx.stroke();
  for (const h of d.highlights) { const at = d.frame.p[h.id]; if (at && h.label) tag(ctx, l, at, h.label, "#E8574C", true); }
  for (const r of d.routes) { const end = r.points[r.points.length - 1]; if (end && r.label) tag(ctx, l, end, r.label, r.color); }
  for (const t of d.targets ?? []) tag(ctx, l, t.at, t.label, YOU, t.below);
  if (d.caption) {
    ctx.font = `600 ${Math.max(10, l.s * 1.3)}px "Public Sans", sans-serif`;
    ctx.fillStyle = "rgba(240,236,224,0.8)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const [cx, cy] = px(l, VIEW_X0 + 1.5, 3.2); ctx.fillText(d.caption, cx, cy);
  }
}

export function hitTarget(canvas: HTMLCanvasElement, targets: Array<{ id: string; at: XY }>, ex: number, ey: number): string | null {
  const l = layoutOf(canvas.clientWidth, canvas.clientHeight);
  let best: string | null = null, bd = 26;
  for (const t of targets) { const [x, y] = px(l, ...t.at); const d = Math.hypot(x - ex, y - ey); if (d < bd) { bd = d; best = t.id; } }
  return best;
}
