import { useCallback, useEffect, useRef, useState } from "react";
import type { N } from "../types";
import { CATS, catOf, fmt, pathOf, pct } from "../util";

interface Rect { n: N; x: number; y: number; w: number; h: number; d: number; leaf: boolean }
interface Props {
  view: N;
  sel: N | null;
  marked: Set<N> | null;
  cat: string | null;
  onSelect: (n: N) => void;
  onZoom: (n: N) => void;
  onUp: () => void;
}

function squarify(kids: N[], x: number, y: number, w: number, h: number, out: (n: N, x: number, y: number, w: number, h: number) => void) {
  let total = 0;
  for (const k of kids) total += k.s;
  if (total <= 0 || w <= 0 || h <= 0) return;
  const scale = (w * h) / total;
  let i = 0;
  while (i < kids.length && kids[i].s > 0) {
    const short = Math.min(w, h);
    let j = i, sum = 0, best = Infinity;
    const maxA = kids[i].s * scale;
    while (j < kids.length && kids[j].s > 0) {
      const a = kids[j].s * scale, ns = sum + a;
      const worst = Math.max((short * short * maxA) / (ns * ns), (ns * ns) / (short * short * a));
      if (j > i && worst > best) break;
      best = worst; sum = ns; j++;
    }
    const thick = sum / short;
    if (w >= h) {
      let yy = y;
      for (let k = i; k < j; k++) { const hh = (kids[k].s * scale) / thick; out(kids[k], x, yy, thick, hh); yy += hh; }
      x += thick; w -= thick;
    } else {
      let xx = x;
      for (let k = i; k < j; k++) { const ww = (kids[k].s * scale) / thick; out(kids[k], xx, y, ww, thick); xx += ww; }
      y += thick; h -= thick;
    }
    i = j;
  }
}

const FONT = "11px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

function hatch(): CanvasPattern | null {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(94,234,212,.7)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(-2, 10); g.lineTo(10, -2); g.stroke();
  return g.createPattern(c, "repeat");
}

export function Treemap({ view, sel, marked, cat, onSelect, onZoom, onUp }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const st = useRef({
    rects: [] as Rect[], W: 0, H: 0, dpr: 1, hover: null as Rect | null, raf: 0, lraf: 0, pat: null as CanvasPattern | null,
    z: 1, ox: 0, oy: 0, down: null as { x: number; y: number; ox: number; oy: number } | null, moved: false,
  });
  const [zoomPct, setZoomPct] = useState(100);
  const props = useRef({ view, sel, marked, cat });
  props.current = { view, sel, marked, cat };

  const draw = useCallback(() => {
    const s = st.current;
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { sel, marked, cat } = props.current;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.fillStyle = "#0b0e12";
    ctx.fillRect(0, 0, s.W, s.H);
    ctx.setTransform(s.dpr, 0, 0, s.dpr, -s.ox * s.dpr, -s.oy * s.dpr);
    ctx.textBaseline = "middle";
    ctx.font = FONT;

    for (const r of s.rects) {
      const { n, x, y, w, h, d } = r;
      if (!r.leaf) {
        if (d > 0) {
          ctx.fillStyle = d % 2 ? "#0f1318" : "#141a21";
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = "#232b36";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          if (w > 64 && h > 38) {
            ctx.fillStyle = "#6b7686";
            const lx = Math.max(x, s.ox) + 5, lw = Math.min(x + w, s.ox + s.W) - Math.max(x, s.ox) - 10;
            const ly = Math.max(y, s.oy) + 9;
            if (lw > 30 && ly < y + h - 12) label(ctx, n.n, lx, ly, lw);
          }
        }
        continue;
      }
      const c = catOf(n);
      const base = c ? CATS[c].color : "#1b222b";
      const dim = cat && c !== cat;
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, h);
      if (w > 54 && h > 16 && !dim) {
        const ink = c ? CATS[c].ink : "#e6ebf2";
        ctx.fillStyle = ink;
        // keep the label inside the visible part of a big, partly off-screen tile
        const lx = Math.max(x, s.ox) + 5, lw = Math.min(x + w, s.ox + s.W) - Math.max(x, s.ox) - 10;
        const ly = Math.max(y, s.oy) + 9;
        if (lw > 30 && ly < y + h - 8) {
          label(ctx, n.k === 2 ? `Small files (${n.f.toLocaleString()})` : n.n, lx, ly, lw);
          if (h > 32 && w > 48 && ly + 13 < y + h - 4) { ctx.globalAlpha = 0.65; label(ctx, fmt(n.s), lx, ly + 13, lw); ctx.globalAlpha = 1; }
        }
      }
      ctx.globalAlpha = 1;
    }

    if (marked && marked.size) {
      s.pat ??= hatch();
      for (const r of s.rects) {
        if (!marked.has(r.n)) continue;
        if (s.pat) { ctx.fillStyle = s.pat; ctx.fillRect(r.x, r.y, r.w, r.h); }
        ctx.strokeStyle = "#5eead4"; ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
      }
    }
    const ring = (r: Rect | undefined, color: string, lw: number) => {
      if (!r) return;
      ctx.strokeStyle = color; ctx.lineWidth = lw;
      ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, Math.max(0, r.w - lw), Math.max(0, r.h - lw));
    };
    if (sel) ring(s.rects.find((r) => r.n === sel), "#e6ebf2", 3);
    if (s.hover && s.hover.n !== sel) ring(s.hover, "#e6ebf2", 1);
  }, []);

  const schedule = useCallback(() => {
    const s = st.current;
    if (!s.raf) s.raf = requestAnimationFrame(() => { s.raf = 0; draw(); });
  }, [draw]);

  const layout = useCallback(() => {
    const s = st.current;
    s.rects = [];
    s.hover = null;
    const build = (n: N, x: number, y: number, w: number, h: number, d: number, vis: (x: number, y: number, w: number, h: number) => boolean) => {
      const canNest = n.k === 0 && !!n.c?.length && w > 12 && h > 12;
      s.rects.push({ n, x, y, w, h, d, leaf: !canNest });
      if (!canNest) return;
      const pad = d === 0 ? 0 : 1;
      const hdr = d > 0 && w > 64 && h > 38 ? 15 : 0;
      squarify(n.c!, x + pad, y + pad + hdr, w - 2 * pad, h - 2 * pad - hdr, (c, cx, cy, cw, ch) => {
        if (cw * ch >= 5 && vis(cx, cy, cw, ch)) build(c, cx + 0.5, cy + 0.5, cw - 1, ch - 1, d + 1, vis);
      });
    };
    const vis = (x: number, y: number, w: number, h: number) =>
      x + w >= s.ox && x <= s.ox + s.W && y + h >= s.oy && y <= s.oy + s.H;
    if (s.W > 0) build(props.current.view, 0, 0, s.W * s.z, s.H * s.z, 0, vis);
    draw();
  }, [draw]);

  const scheduleLayout = useCallback(() => {
    const s = st.current;
    if (!s.lraf) s.lraf = requestAnimationFrame(() => { s.lraf = 0; layout(); });
  }, [layout]);

  const clampCam = () => {
    const s = st.current;
    s.ox = Math.min(Math.max(0, s.ox), Math.max(0, s.W * s.z - s.W));
    s.oy = Math.min(Math.max(0, s.oy), Math.max(0, s.H * s.z - s.H));
  };
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    const s = st.current;
    const nz = Math.min(200, Math.max(1, s.z * factor));
    if (nz === s.z) return;
    const k = nz / s.z;
    s.ox = (s.ox + sx) * k - sx;
    s.oy = (s.oy + sy) * k - sy;
    s.z = nz;
    clampCam();
    setZoomPct(Math.round(nz * 100));
    scheduleLayout();
  }, [scheduleLayout]);
  const resetCam = useCallback(() => {
    const s = st.current;
    s.z = 1; s.ox = 0; s.oy = 0;
    setZoomPct(100);
  }, []);

  useEffect(() => {
    const el = wrap.current!;
    const resize = () => {
      const b = el.getBoundingClientRect();
      const s = st.current;
      s.dpr = window.devicePixelRatio || 1;
      s.W = Math.floor(b.width); s.H = Math.floor(b.height);
      const c = cv.current!;
      c.width = Math.floor(s.W * s.dpr); c.height = Math.floor(s.H * s.dpr);
      clampCam();
      layout();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  useEffect(() => { resetCam(); layout(); }, [view, layout, resetCam]);

  // keyboard: + / - zoom, 0 resets (not while typing in the command line)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;
      const s = st.current;
      if (e.key === "+" || e.key === "=") zoomAt(s.W / 2, s.H / 2, 1.6);
      else if (e.key === "-" || e.key === "_") zoomAt(s.W / 2, s.H / 2, 1 / 1.6);
      else if (e.key === "0") { resetCam(); layout(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [zoomAt, resetCam, layout]);
  useEffect(schedule, [sel, marked, cat, schedule]);

  const hit = (ev: React.MouseEvent) => {
    const b = cv.current!.getBoundingClientRect();
    const x = ev.clientX - b.left + st.current.ox, y = ev.clientY - b.top + st.current.oy;
    const rects = st.current.rects;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  };

  const onMove = (ev: React.MouseEvent) => {
    const s = st.current;
    if (s.down && (ev.buttons & 1)) {
      const dx = ev.clientX - s.down.x, dy = ev.clientY - s.down.y;
      if (!s.moved && Math.hypot(dx, dy) > 4) s.moved = true;
      if (s.moved && s.z > 1) {
        s.ox = s.down.ox - dx; s.oy = s.down.oy - dy;
        clampCam();
        tip.current!.hidden = true;
        scheduleLayout();
        return;
      }
    }
    const r = hit(ev);
    if (r !== s.hover) { s.hover = r; schedule(); }
    const t = tip.current!;
    if (!r) { t.hidden = true; return; }
    const n = r.n;
    const b = document.createElement("b");
    b.textContent = n.k === 2 ? "Small files" : pathOf(n);
    const sm = document.createElement("small");
    sm.textContent = `${fmt(n.s)} · ${pct(n.s, props.current.view.s)} of view · ${n.f.toLocaleString()} file${n.f === 1 ? "" : "s"}`;
    t.replaceChildren(b, sm);
    t.hidden = false;
    const w = wrap.current!.getBoundingClientRect();
    let tx = ev.clientX - w.left + 14, ty = ev.clientY - w.top + 16;
    if (tx + t.offsetWidth > w.width - 6) tx = ev.clientX - w.left - t.offsetWidth - 14;
    if (ty + t.offsetHeight > w.height - 6) ty = ev.clientY - w.top - t.offsetHeight - 12;
    t.style.left = tx + "px"; t.style.top = ty + "px";
  };

  return (
    <div className="map-wrap" ref={wrap}>
      <canvas
        ref={cv}
        className={zoomPct > 100 ? "zoomed" : ""}
        onMouseMove={onMove}
        onMouseDown={(ev) => { const s = st.current; s.down = { x: ev.clientX, y: ev.clientY, ox: s.ox, oy: s.oy }; s.moved = false; }}
        onMouseUp={() => { st.current.down = null; }}
        onWheel={(ev) => { const b = cv.current!.getBoundingClientRect(); zoomAt(ev.clientX - b.left, ev.clientY - b.top, Math.exp(-ev.deltaY * 0.0018)); }}
        onMouseLeave={() => { const s = st.current; s.hover = null; s.down = null; tip.current!.hidden = true; schedule(); }}
        onClick={(ev) => { if (st.current.moved) { st.current.moved = false; return; } const r = hit(ev); if (r) onSelect(r.n); }}
        onDoubleClick={(ev) => {
          const r = hit(ev);
          const n = r && (r.n.k === 0 ? r.n : r.n.p);
          if (n && n !== props.current.view) onZoom(n);
        }}
        onContextMenu={(ev) => { ev.preventDefault(); if (st.current.z > 1) { resetCam(); layout(); } else onUp(); }}
      />
      <div className="zoom">
        <button onClick={() => zoomAt(st.current.W / 2, st.current.H / 2, 1 / 1.6)} title="Zoom out (-)" disabled={zoomPct <= 100}>−</button>
        <button className="pct" onClick={() => { resetCam(); layout(); }} title="Reset (0)" disabled={zoomPct <= 100}>{zoomPct}%</button>
        <button onClick={() => zoomAt(st.current.W / 2, st.current.H / 2, 1.6)} title="Zoom in (+)">+</button>
      </div>
      <div className="tip" ref={tip} hidden />
    </div>
  );
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  let t = text;
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    t += "…";
  }
  ctx.fillText(t, x, y);
}
