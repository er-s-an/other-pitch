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
  const [ax, ay] = px(l, L - 30, 3.2);
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
}

function playerDisc(ctx: CanvasRenderingContext2D, l: Layout, info: PlayerInfo, at: XY, ring: string | null) {
  const [x, y] = px(l, at[0], at[1]);
  const r = Math.max(11, Math.min(18, l.s * 1.28));
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = info.team === "home" ? HOME : AWAY; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.stroke();
  if (info.team === "away") { // away: square notch so teams differ by shape, not only colour
    ctx.fillStyle = "#c9463d"; ctx.fillRect(x - r * 0.55, y - r - 1.5, r * 1.1, r * 0.38);
  }
  if (ring === "carrier") {
    ctx.beginPath(); ctx.arc(x, y, r + 6.5, 0, Math.PI * 2); ctx.strokeStyle = YOU; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.stroke();
  } else if (ring) {
    ctx.beginPath(); ctx.arc(x, y, r + 5.5, 0, Math.PI * 2); ctx.strokeStyle = ring; ctx.lineWidth = ring === "#E8574C" ? 3.2 : 2.8; ctx.stroke();
  }
  ctx.fillStyle = info.team === "home" ? HOME_INK : AWAY_INK;
  ctx.font = `700 ${Math.max(11, Math.round(r * 0.92))}px "Public Sans", sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(info.number), x, y + 0.5);
}

interface Box { x: number; y: number; w: number; h: number }
interface TagItem { at: XY; text: string; color: string; below?: boolean }
const overlaps = (a: Box, b: Box, gap = 4) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

function drawTags(ctx: CanvasRenderingContext2D, l: Layout, items: TagItem[], reserved: Box[]) {
  const occupied = reserved.slice();
  const fs = Math.max(11, Math.min(13, l.s * 1.45));
  ctx.font = `600 ${fs}px "Public Sans", sans-serif`;
  for (const item of items) {
    if (!item.text) continue;
    const [cx0, y0] = px(l, item.at[0], item.at[1]);
    const w = Math.min(l.w - 8, ctx.measureText(item.text).width + 14);
    const h = fs + 8;
    let below = !!item.below;
    let y = below ? y0 + l.s * 1.85 + 2 : y0 - l.s * 1.85 - h - 2;
    const x = Math.max(4, Math.min(l.w - w - 4, cx0 - w / 2));
    let box: Box = { x, y, w, h };
    for (let n = 0; n < 10 && occupied.some((o) => overlaps(box, o)); n++) {
      if (!below && box.y - (h + 3) >= 4) box = { ...box, y: box.y - (h + 3) };
      else { below = true; box = { ...box, y: Math.min(l.h - h - 4, box.y + h + 3) }; }
    }
    for (let n = 0; n < 6 && occupied.some((o) => overlaps(box, o)); n++) {
      const next = box.x + 14;
      box = { ...box, x: next + w > l.w - 4 ? Math.max(4, box.x - 14) : next };
    }
    occupied.push(box);
    ctx.fillStyle = "rgba(6,12,10,0.9)";
    ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 4); ctx.fill();
    ctx.fillStyle = item.color; ctx.fillRect(box.x, box.y, 3, box.h);
    ctx.fillStyle = "#F3F0E7"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(item.text, box.x + 8, box.y + box.h / 2 + 0.5);
  }
}

function ballGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y + 1.5, r + 2.2, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, Math.PI * 2); ctx.fillStyle = "#14160f"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "#f4f1e6"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = "#16181c"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.lineWidth = Math.max(1.25, r * 0.14); ctx.strokeStyle = "#121410"; ctx.stroke();
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
  const reserved: Box[] = [];
  const [capX, capY] = px(l, VIEW_X0 + 1.5, 3.2);
  reserved.push({ x: capX - 6, y: capY - 14, w: Math.min(300, l.w * 0.58), h: 26 });
  const [atkX, atkY] = px(l, L - 30, 3.2);
  reserved.push({ x: atkX - 6, y: atkY - 14, w: 150, h: 26 });
  if (d.offsideX != null) {
    const [ox, oy0] = px(l, d.offsideX, 0), [, oy1] = px(l, d.offsideX, W);
    ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = "rgba(143,211,232,0.22)"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(ox, oy0); ctx.lineTo(ox, oy1); ctx.stroke();
    ctx.setLineDash([5, 4]); ctx.strokeStyle = "#b7e7f4"; ctx.lineWidth = 1.75;
    ctx.beginPath(); ctx.moveTo(ox, oy0); ctx.lineTo(ox, oy1); ctx.stroke(); ctx.restore();
    const label = "OFFSIDE";
    ctx.font = `700 ${Math.max(10, Math.min(12, l.s * 1.2))}px "Public Sans", sans-serif`;
    const tw = ctx.measureText(label).width + 10, th = 16;
    let lx = ox + 6; if (lx + tw > l.w - 6) lx = ox - tw - 6;
    const ly = Math.min(oy1 - th - 8, oy0 + 36);
    ctx.fillStyle = "rgba(6,14,18,0.88)"; ctx.beginPath(); ctx.roundRect(lx, ly, tw, th, 3); ctx.fill();
    ctx.fillStyle = "#d7f3fb"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(label, lx + 5, ly + th / 2 + 0.5);
    reserved.push({ x: lx, y: ly, w: tw, h: th });
  }
  for (const a of d.arrows ?? []) {
    const [x1, y1] = px(l, ...a.at), [x2, y2] = px(l, a.at[0] + a.v[0] * 1.2, a.at[1] + a.v[1] * 1.2);
    if (Math.hypot(x2 - x1, y2 - y1) < 4) continue;
    ctx.save(); ctx.strokeStyle = "rgba(242,238,227,0.45)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1); ctx.beginPath(); ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 6 * Math.cos(ang - 0.5), y2 - 6 * Math.sin(ang - 0.5)); ctx.lineTo(x2 - 6 * Math.cos(ang + 0.5), y2 - 6 * Math.sin(ang + 0.5)); ctx.closePath();
    ctx.fillStyle = "rgba(242,238,227,0.45)"; ctx.fill(); ctx.restore();
  }
  const ringFor = new Map(d.highlights.map((h) => [h.id, "#E8574C"]));
  if (d.selected && d.selected !== d.carrierId) ringFor.set(d.selected, YOU);
  ringFor.set(d.carrierId, "carrier");
  for (const info of d.players) {
    const at = d.frame.p[info.id];
    if (at) playerDisc(ctx, l, info, at, ringFor.get(info.id) ?? null);
  }
  const [bx, by] = px(l, ...d.frame.ball), br = Math.max(6.2, l.s * 0.78);
  for (const r of d.routes) {
    if (r.dashed || r.points.length < 3) continue;
    const tail = r.points.slice(-7, -1);
    tail.forEach((p, i) => {
      const [tx, ty] = px(l, p[0], p[1]);
      ctx.beginPath(); ctx.arc(tx, ty, br * (0.45 + i / tail.length * 0.35), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(244,241,230,${0.08 + (i / tail.length) * 0.28})`; ctx.fill();
    });
  }
  ballGlyph(ctx, bx, by, br);
  for (const t of d.targets ?? []) {
    const [x, y] = px(l, ...t.at);
    ctx.beginPath(); ctx.arc(x, y, t.hot ? 22 : 18, 0, Math.PI * 2);
    ctx.strokeStyle = t.hot ? YOU : "rgba(245,197,66,0.9)"; ctx.lineWidth = t.hot ? 3 : 2; ctx.setLineDash(t.hot ? [] : [5, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fillStyle = YOU; ctx.fill();
  }
  const tags: TagItem[] = [];
  for (const h of d.highlights) { const at = d.frame.p[h.id]; if (at && h.label) tags.push({ at, text: h.label, color: "#E8574C", below: true }); }
  for (const r of d.routes) { const end = r.points[r.points.length - 1]; if (end && r.label) tags.push({ at: end, text: r.label, color: r.color }); }
  for (const t of d.targets ?? []) tags.push({ at: t.at, text: t.label, color: YOU, below: t.below });
  drawTags(ctx, l, tags, reserved);
  if (d.caption) {
    ctx.font = `600 ${Math.max(10, l.s * 1.3)}px "Public Sans", sans-serif`;
    ctx.fillStyle = "rgba(240,236,224,0.8)"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const [cx, cy] = px(l, VIEW_X0 + 1.5, 3.2); ctx.fillText(d.caption, cx, cy);
  }
}

export function hitTarget(canvas: HTMLCanvasElement, targets: Array<{ id: string; at: XY }>, ex: number, ey: number, pad = 36): string | null {
  const l = layoutOf(canvas.clientWidth, canvas.clientHeight);
  let best: string | null = null, bd = pad;
  for (const t of targets) { const [x, y] = px(l, ...t.at); const d = Math.hypot(x - ex, y - ey); if (d < bd) { bd = d; best = t.id; } }
  return best;
}
