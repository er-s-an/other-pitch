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
export function toPitch(canvas: HTMLCanvasElement, ex: number, ey: number): XY {
  const l = layoutOf(canvas.clientWidth, canvas.clientHeight);
  return [(ex - l.ox) / l.s, (ey - l.oy) / l.s];
}
export function pxPerMetre(canvas: HTMLCanvasElement) { return layoutOf(canvas.clientWidth, canvas.clientHeight).s; }

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
  const [ax, ay] = px(l, VIEW_X0 + 1.5, W - 3.4);
  ctx.fillStyle = "rgba(240,236,224,0.55)";
  ctx.font = `600 ${Math.max(10, l.s * 1.35)}px "Public Sans", sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("ATTACKING  \u2192", ax, ay);
}

export interface Route { points: XY[]; color: string; dashed: boolean; label: string; progress?: number; alpha?: number; width?: number }
export interface Highlight { id: string; label: string; ghostFrom?: XY }

export interface DrawInput {
  frame: Frame; players: PlayerInfo[]; carrierId: string; routes: Route[]; targets?: Array<{ id: string; at: XY; label: string; hot: boolean; below?: boolean }>;
  highlights: Highlight[]; laneBand?: { from: XY; to: XY } | null; zones?: Array<{ at: XY; r: number }>; caption?: string;
  arrows?: Array<{ at: XY; v: XY }>; selected?: string | null; offsideX?: number | null;
  /** Player ids who can receive the current pass. Gold dashed ring plus shirt number. */
  targetIds?: string[];
}

type RingKind = "carrier" | "target" | "key" | "select";

function strokeRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, width: number, dash?: number[]) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function playerDisc(ctx: CanvasRenderingContext2D, l: Layout, info: PlayerInfo, at: XY, rings: RingKind[]) {
  const [x, y] = px(l, at[0], at[1]);
  const r = Math.max(8, l.s * 1.08);
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.9, r * 1.05, r * 0.38, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = info.team === "home" ? HOME : AWAY; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.stroke();
  if (info.team === "away") {
    ctx.fillStyle = "#c9463d"; ctx.fillRect(x - r * 0.55, y - r - 1, r * 1.1, r * 0.42);
  }
  // Dark backing ring so white, gold and red stay readable on both shirts and both grass stripes.
  let extra = 0;
  if (rings.includes("key")) {
    strokeRing(ctx, x, y, r + 4 + extra, "#0b1a14", 4.4);
    strokeRing(ctx, x, y, r + 4 + extra, "#e8574c", 2.4);
    extra += 4;
  }
  if (rings.includes("target")) {
    strokeRing(ctx, x, y, r + 4 + extra, "#0b1a14", 4.2);
    strokeRing(ctx, x, y, r + 4 + extra, YOU, 2.2, [3.5, 3]);
    extra += 4;
  }
  if (rings.includes("carrier")) {
    strokeRing(ctx, x, y, r + 4 + extra, "#0b1a14", 5);
    strokeRing(ctx, x, y, r + 4 + extra, "#f7f4ea", 2.6);
    extra += 4;
  }
  if (rings.includes("select")) {
    strokeRing(ctx, x, y, r + 4 + extra, YOU, 3);
  }
  const num = String(info.number);
  const fs = Math.max(11, Math.round(r * 0.98));
  ctx.font = `700 ${fs}px "Public Sans", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = info.team === "home" ? "rgba(255,255,255,0.55)" : "rgba(11,26,20,0.35)";
  ctx.strokeText(num, x, y + 0.5);
  ctx.fillStyle = info.team === "home" ? HOME_INK : AWAY_INK;
  ctx.fillText(num, x, y + 0.5);
}

interface Box { x: number; y: number; w: number; h: number }
function overlaps(a: Box, b: Box, gap = 8) {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}
function overlapArea(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, br: number) {
  ctx.beginPath(); ctx.ellipse(x, y + br * 0.95, br * 0.95, br * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, br + 2.2, 0, Math.PI * 2); ctx.fillStyle = "#14120c"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI * 2); ctx.fillStyle = "#f4f1e6"; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, br - 0.4, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#161814";
  ctx.beginPath();
  const pr = br * 0.48;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px0 = x + Math.cos(a) * pr, py0 = y + Math.sin(a) * pr;
    if (i) ctx.lineTo(px0, py0); else ctx.moveTo(px0, py0);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, br, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1.4, br * 0.16);
  ctx.strokeStyle = "#161814";
  ctx.stroke();
}

function paintTag(ctx: CanvasRenderingContext2D, l: Layout, occupied: Box[], at: XY, text: string, color: string, below = false) {
  const [cx0, y0] = px(l, at[0], at[1]);
  const fs = Math.max(11, Math.min(13, l.s * 1.45));
  ctx.font = `600 ${fs}px "Public Sans", sans-serif`;
  const w = Math.min(l.w - 8, ctx.measureText(text).width + 14);
  const h = fs + 10;
  const prefs = below ? [1, -1] : [-1, 1];
  const candidates: Box[] = [];
  const clampX = (x: number) => Math.max(4, Math.min(l.w - w - 4, x));
  for (const dir of prefs) {
    for (let step = 0; step < 4; step++) {
      const y = dir < 0 ? y0 - l.s * 1.8 - h - 4 - step * (h + 2) : y0 + l.s * 1.8 + 4 + step * (h + 2);
      for (const slide of [0, -0.7, 0.7, -1.3, 1.3]) candidates.push({ x: clampX(cx0 - w / 2 + slide * w), y, w, h });
    }
  }
  for (const sx of [1, -1]) {
    for (const dy of [0, -(h + 6), h + 6]) {
      candidates.push({ x: clampX(cx0 + sx * (l.s * 1.8 + 8)), y: Math.max(4, Math.min(l.h - h - 4, y0 - h / 2 + dy)), w, h });
    }
  }
  let chosen = candidates[0];
  let best = Infinity;
  for (const c of candidates) {
    if (c.y < 2 || c.y + c.h > l.h - 2) continue;
    const hit = occupied.reduce((sum, o) => sum + (overlaps(c, o) ? overlapArea(c, o) + 64 : 0), 0);
    if (hit < best) { best = hit; chosen = c; if (hit === 0) break; }
  }
  occupied.push(chosen);
  ctx.fillStyle = "rgba(6,12,10,0.9)";
  ctx.beginPath(); ctx.roundRect(chosen.x, chosen.y, chosen.w, chosen.h, 4); ctx.fill();
  ctx.fillStyle = color; ctx.fillRect(chosen.x, chosen.y, 3, chosen.h);
  ctx.fillStyle = "#F3F0E7"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(text, chosen.x + 8, chosen.y + chosen.h / 2 + 0.5, Math.max(0, chosen.w - 12));
}

export function draw(canvas: HTMLCanvasElement, d: DrawInput) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w < 40 || h < 40) return;
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
    ctx.strokeStyle = r.color; ctx.lineWidth = r.width ?? (r.dashed ? 2.2 : 3.4); ctx.globalAlpha = r.alpha ?? (r.dashed ? 0.85 : 1);
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
  if (d.offsideX != null) {
    const [ox, oy0] = px(l, d.offsideX, 0), [, oy1] = px(l, d.offsideX, W);
    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(ox, oy0); ctx.lineTo(ox, oy1);
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy0); ctx.lineTo(ox, oy1);
    ctx.strokeStyle = "rgba(243,240,231,0.95)"; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.restore();
  }
  for (const a of d.arrows ?? []) {
    const [x1, y1] = px(l, ...a.at), [x2, y2] = px(l, a.at[0] + a.v[0] * 1.2, a.at[1] + a.v[1] * 1.2);
    if (Math.hypot(x2 - x1, y2 - y1) < 4) continue;
    ctx.save(); ctx.strokeStyle = "rgba(242,238,227,0.45)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 6 * Math.cos(ang - 0.5), y2 - 6 * Math.sin(ang - 0.5)); ctx.lineTo(x2 - 6 * Math.cos(ang + 0.5), y2 - 6 * Math.sin(ang + 0.5)); ctx.closePath();
    ctx.fillStyle = "rgba(242,238,227,0.45)"; ctx.fill(); ctx.restore();
  }
  const targetSet = new Set(d.targetIds ?? []);
  const keySet = new Set(d.highlights.map((h) => h.id));
  for (const info of d.players) {
    const at = d.frame.p[info.id];
    if (!at) continue;
    const rings: RingKind[] = [];
    if (keySet.has(info.id)) rings.push("key");
    if (targetSet.has(info.id)) rings.push("target");
    if (info.id === d.carrierId) rings.push("carrier");
    if (info.id === d.selected) rings.push("select");
    playerDisc(ctx, l, info, at, rings);
  }
  const solid = [...d.routes].reverse().find((r) => !r.dashed && r.points.length > 4);
  const br = Math.max(5.6, l.s * 0.78);
  let ballAt = d.frame.ball;
  const carrierAt = d.frame.p[d.carrierId];
  if (carrierAt && Math.hypot(ballAt[0] - carrierAt[0], ballAt[1] - carrierAt[1]) < 1.4) {
    const discPx = Math.max(8, l.s * 1.08);
    const sep = (discPx + br + 4) / Math.max(1, l.s);
    ballAt = [carrierAt[0] + sep, carrierAt[1]];
  }
  const [bx, by] = px(l, ...ballAt);
  if (solid) {
    const tail = solid.points.slice(-7, -1);
    tail.forEach((p, i) => {
      const [tx, ty] = px(l, p[0], p[1]);
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(2, br * (0.28 + i * 0.06)), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20,18,12,${0.18 + i * 0.08})`;
      ctx.fill();
    });
  }
  drawBall(ctx, bx, by, br);
  const occupied: Box[] = [];
  const discR = Math.max(8, l.s * 1.08) + 16;
  for (const info of d.players) {
    const at = d.frame.p[info.id];
    if (!at) continue;
    const [x, y] = px(l, at[0], at[1]);
    occupied.push({ x: x - discR, y: y - discR, w: discR * 2, h: discR * 2 });
  }
  occupied.push({ x: bx - br - 12, y: by - br - 12, w: (br + 12) * 2, h: (br + 12) * 2 });
  // Keep tags off the top cue, the corner badge, and the bottom edge.
  const [, topY] = px(l, 0, 0);
  occupied.push({ x: 0, y: Math.max(0, topY - 4), w: l.w, h: l.s * 5.2 });
  occupied.push({ x: l.w - 168, y: l.h - 40, w: 168, h: 40 });
  const [atkX, atkY] = px(l, VIEW_X0 + 1.5, W - 3.4);
  occupied.push({ x: atkX - 4, y: atkY - 12, w: 120, h: 24 });
  if (d.caption) {
    ctx.font = `600 ${Math.max(11, l.s * 1.35)}px "Public Sans", sans-serif`;
    const capW = Math.min(l.w * 0.55, ctx.measureText(d.caption).width + 8);
    const [cx, cy] = px(l, VIEW_X0 + 1.5, 3.2);
    occupied.push({ x: cx - 2, y: cy - 10, w: capW, h: 20 });
    ctx.fillStyle = "rgba(11,26,20,0.55)";
    ctx.fillRect(cx - 4, cy - 9, capW + 4, 18);
    ctx.fillStyle = "rgba(243,240,231,0.95)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(d.caption, cx, cy);
  }
  for (const h of d.highlights) {
    const at = d.frame.p[h.id];
    if (at && h.label) paintTag(ctx, l, occupied, at, h.label, "#E8574C", at[1] < 18);
  }
  for (const r of d.routes) { const end = r.points[r.points.length - 1]; if (end && r.label) paintTag(ctx, l, occupied, end, r.label, r.color, end[1] < 18); }
  for (const t of d.targets ?? []) if (t.label) paintTag(ctx, l, occupied, t.at, t.label, YOU, t.below ?? t.at[1] < 18);
  if (d.offsideX != null) paintTag(ctx, l, occupied, [d.offsideX, 20], "Offside", "#f3f0e7", true);
}

export function hitTarget(canvas: HTMLCanvasElement, targets: Array<{ id: string; at: XY }>, ex: number, ey: number): string | null {
  const l = layoutOf(canvas.clientWidth, canvas.clientHeight);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  let best: string | null = null, bd = coarse ? 32 : 26;
  for (const t of targets) { const [x, y] = px(l, ...t.at); const d = Math.hypot(x - ex, y - ey); if (d < bd) { bd = d; best = t.id; } }
  return best;
}
