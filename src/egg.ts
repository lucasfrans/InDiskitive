// Easter egg: an A-10 Warthog strafes a tile. Purely visual, nothing on disk is touched.

export interface Target { cx: number; cy: number; w: number; h: number; label: string }

interface Bullet { x: number; y: number; vx: number; vy: number; left: number; ax: number; ay: number }
interface Boom { x: number; y: number; r: number; t0: number; dur: number }
interface Spark { x: number; y: number; vx: number; vy: number; t0: number; life: number }
interface Puff { x: number; y: number; r: number; t0: number; life: number; up: number; dark: boolean }
interface Scorch { x: number; y: number; r: number }

const MONO = "11px 'Cascadia Mono', Consolas, monospace";

function poly(ctx: CanvasRenderingContext2D, pts: number[][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** Side view, nose to +x. Origin is the middle of the fuselage. */
function drawA10(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, s: number, firing: boolean, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * s, s);

  const eg = ctx.createRadialGradient(-108, -15, 0, -108, -15, 30);
  eg.addColorStop(0, "rgba(255,180,90,.85)");
  eg.addColorStop(1, "rgba(255,120,40,0)");
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.arc(-108, -15, 30, 0, Math.PI * 2); ctx.fill();

  // far tail fin and stabiliser
  ctx.fillStyle = "#4a535e";
  poly(ctx, [[-62, -6], [-72, -34], [-50, -34], [-38, -6]]);
  ctx.fillStyle = "#59626d";
  poly(ctx, [[-104, -8], [-58, -8], [-58, -4], [-104, -4]]);

  // underwing stores
  ctx.fillStyle = "#3e464f";
  ctx.beginPath(); ctx.ellipse(8, 22, 14, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(34, 21, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(6, 10, 3, 9); ctx.fillRect(32, 10, 3, 8);

  // wing, edge-on
  ctx.fillStyle = "#56606b";
  poly(ctx, [[-26, 6], [58, 6], [58, 11], [-26, 11]]);

  // fuselage
  const fg = ctx.createLinearGradient(0, -12, 0, 12);
  fg.addColorStop(0, "#a3adb9");
  fg.addColorStop(1, "#5c6671");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-86, -6);
  ctx.lineTo(36, -11);
  ctx.quadraticCurveTo(92, -9, 108, 4);
  ctx.lineTo(40, 11);
  ctx.lineTo(-86, 5);
  ctx.closePath();
  ctx.fill();

  // engine pods on the back
  ctx.fillStyle = "#6b7580";
  ctx.beginPath(); ctx.roundRect(-64, -27, 58, 20, 8); ctx.fill();
  ctx.fillStyle = "#222830";
  ctx.beginPath(); ctx.ellipse(-8, -17, 4.5, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a424b";
  ctx.beginPath(); ctx.ellipse(-64, -17, 3.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();

  // near tail fin
  ctx.fillStyle = "#7f8995";
  poly(ctx, [[-84, -6], [-96, -37], [-72, -37], [-56, -6]]);

  // canopy
  const cg = ctx.createLinearGradient(0, -22, 0, -8);
  cg.addColorStop(0, "#cfe6f7");
  cg.addColorStop(1, "#6fa3cc");
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.ellipse(62, -13, 21, 8, -0.05, Math.PI, 0); ctx.closePath(); ctx.fill();

  // nose gun
  ctx.fillStyle = "#2b3138";
  ctx.fillRect(104, 3, 16, 3);
  if (firing && Math.floor(t / 35) % 2 === 0) {
    ctx.fillStyle = "#ffe08a";
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 7 : 16;
      ctx.lineTo(126 + Math.cos(a) * r, 4.5 + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function sound(durMs: number, fireFrom: number, fireTo: number, boomAt: number) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const a = new AC();
    const now = a.currentTime;
    const master = a.createGain();
    master.gain.value = 0.45;
    master.connect(a.destination);
    const nb = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const n = a.createBufferSource(); n.buffer = nb; n.loop = true; return n; };

    // jet pass
    const j = noise(), jf = a.createBiquadFilter(), jg = a.createGain();
    jf.type = "bandpass"; jf.Q.value = 0.8;
    jf.frequency.setValueAtTime(260, now);
    jf.frequency.linearRampToValueAtTime(900, now + durMs / 2000);
    jf.frequency.linearRampToValueAtTime(240, now + durMs / 1000);
    jg.gain.setValueAtTime(0, now);
    jg.gain.linearRampToValueAtTime(0.35, now + durMs / 2000);
    jg.gain.linearRampToValueAtTime(0, now + durMs / 1000);
    j.connect(jf); jf.connect(jg); jg.connect(master);
    j.start(now); j.stop(now + durMs / 1000 + 0.1);

    // the gun: low-passed noise chopped at ~62 Hz
    const g = noise(), gf = a.createBiquadFilter(), pulse = a.createGain(), env = a.createGain();
    gf.type = "lowpass"; gf.frequency.value = 1000;
    pulse.gain.value = 0.5;
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.type = "square"; lfo.frequency.value = 62; lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(pulse.gain);
    env.gain.setValueAtTime(0, now);
    env.gain.setValueAtTime(0.9, now + fireFrom / 1000);
    env.gain.setValueAtTime(0, now + fireTo / 1000 + 0.15);
    g.connect(gf); gf.connect(pulse); pulse.connect(env); env.connect(master);
    g.start(now); lfo.start(now);
    g.stop(now + durMs / 1000); lfo.stop(now + durMs / 1000);

    // the boom
    const o = a.createOscillator(), og = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(130, now + boomAt / 1000);
    o.frequency.exponentialRampToValueAtTime(32, now + boomAt / 1000 + 0.8);
    og.gain.setValueAtTime(0, now);
    og.gain.setValueAtTime(1, now + boomAt / 1000);
    og.gain.exponentialRampToValueAtTime(0.001, now + boomAt / 1000 + 0.9);
    o.connect(og); og.connect(master);
    o.start(now); o.stop(now + boomAt / 1000 + 1);
    const b = noise(), bf = a.createBiquadFilter(), bg = a.createGain();
    bf.type = "lowpass"; bf.frequency.value = 500;
    bg.gain.setValueAtTime(0, now);
    bg.gain.setValueAtTime(0.9, now + boomAt / 1000);
    bg.gain.exponentialRampToValueAtTime(0.001, now + boomAt / 1000 + 0.7);
    b.connect(bf); bf.connect(bg); bg.connect(master);
    b.start(now); b.stop(now + boomAt / 1000 + 0.8);

    setTimeout(() => a.close().catch(() => {}), durMs + 2500);
  } catch { /* no audio is fine */ }
}

export function runWarthog(
  cv: HTMLCanvasElement,
  W: number,
  H: number,
  dpr: number,
  tg: Target,
  shake: (dx: number, dy: number) => void,
  done: () => void,
) {
  cv.width = Math.floor(W * dpr);
  cv.height = Math.floor(H * dpr);
  const ctx = cv.getContext("2d")!;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const s = Math.min(1.25, Math.max(0.7, W / 1300));
  const planeY = Math.max(80, Math.min(tg.cy - 200 * s, H - 140));
  const dur = 3800, X0 = -260, X1 = W + 260;
  const xAt = (p: number) => (dir > 0 ? X0 + (X1 - X0) * p : X1 - (X1 - X0) * p);
  const tAtX = (x: number) => Math.max(0, (dir > 0 ? (x - X0) / (X1 - X0) : (X1 - x) / (X1 - X0)) * dur);
  const fireFrom = tAtX(tg.cx - dir * 440 * s), fireTo = tAtX(tg.cx - dir * 140 * s);
  const boomAt = fireTo + 260;
  const end = dur + 2400;

  const bullets: Bullet[] = [], booms: Boom[] = [], sparks: Spark[] = [], puffs: Puff[] = [], scorches: Scorch[] = [];
  let booming = false;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  const impact = (x: number, y: number, t: number) => {
    scorches.push({ x, y, r: rnd(9, 17) });
    booms.push({ x, y, r: rnd(12, 24), t0: t, dur: 320 });
    for (let i = 0; i < 4; i++) sparks.push({ x, y, vx: rnd(-160, 160), vy: rnd(-260, -40), t0: t, life: rnd(260, 520) });
  };
  const bigBoom = (t: number) => {
    const R = Math.min(170, Math.max(60, Math.min(tg.w, tg.h) * 0.8));
    booms.push({ x: tg.cx, y: tg.cy, r: R, t0: t, dur: 950 });
    booms.push({ x: tg.cx + rnd(-12, 12), y: tg.cy + rnd(-12, 12), r: R * 0.6, t0: t + 120, dur: 800 });
    for (let i = 0; i < 46; i++) sparks.push({ x: tg.cx, y: tg.cy, vx: rnd(-420, 420), vy: rnd(-520, 80), t0: t, life: rnd(500, 1300) });
    for (let i = 0; i < 16; i++) puffs.push({ x: tg.cx + rnd(-R * 0.4, R * 0.4), y: tg.cy + rnd(-R * 0.3, R * 0.3), r: rnd(14, 30), t0: t + rnd(0, 300), life: rnd(1300, 2200), up: rnd(30, 70), dark: true });
  };

  sound(dur, fireFrom, fireTo, boomAt);

  let last = 0, fireAcc = 0, puffAcc = 0;
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = now - t0;
    const dt = Math.min(50, last ? now - last : 16);
    last = now;
    const p = Math.min(1, t / dur);
    const px = xAt(p), py = planeY + Math.sin(t / 260) * 3;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const firing = t >= fireFrom && t <= fireTo;
    if (firing) {
      fireAcc += dt;
      while (fireAcc >= 24) {
        fireAcc -= 24;
        const mx = px + dir * 124 * s, my = py + 5 * s;
        const ax = tg.cx + rnd(-0.28, 0.28) * tg.w, ay = tg.cy + rnd(-0.28, 0.28) * tg.h;
        const dx = ax - mx, dy = ay - my, len = Math.hypot(dx, dy) || 1;
        bullets.push({ x: mx, y: my, vx: (dx / len) * 1500, vy: (dy / len) * 1500, left: len, ax, ay });
      }
    }
    if (!booming && t >= boomAt) { booming = true; bigBoom(t); }

    // lock-on reticle
    if (t < boomAt + 200) {
      const r = Math.max(30, Math.min(tg.w, tg.h) * 0.42);
      ctx.save();
      ctx.translate(tg.cx, tg.cy);
      ctx.strokeStyle = "rgba(255,93,93,.9)";
      ctx.lineWidth = 1.5;
      ctx.rotate(t / 700);
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.rotate(-t / 700);
      for (const a of [0, 1, 2, 3]) {
        ctx.save(); ctx.rotate((a * Math.PI) / 2);
        ctx.beginPath(); ctx.moveTo(r + 4, 0); ctx.lineTo(r + 16, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      ctx.font = MONO;
      ctx.fillStyle = "rgba(255,120,120,.95)";
      ctx.textAlign = "center";
      ctx.fillText(`TARGET LOCKED  ${tg.label}`, tg.cx, tg.cy - r - 22);
    } else if (t < end - 400) {
      ctx.font = MONO;
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, (end - 400 - t) / 600);
      ctx.fillStyle = "#e6ebf2";
      ctx.fillText("DIRECT HIT. (nothing was deleted)", tg.cx, tg.cy - 52);
      ctx.globalAlpha = 1;
    }

    // scorch marks
    const fade = t > dur + 600 ? Math.max(0, 1 - (t - dur - 600) / 1500) : 1;
    for (const sc of scorches) {
      const g = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, sc.r);
      g.addColorStop(0, `rgba(0,0,0,${0.7 * fade})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sc.x, sc.y, sc.r, 0, Math.PI * 2); ctx.fill();
    }

    // contrail
    puffAcc += dt;
    if (p < 1 && puffAcc >= 28) {
      puffAcc = 0;
      puffs.push({ x: px - dir * 104 * s, y: py - 14 * s, r: rnd(4, 7), t0: t, life: 1100, up: 8, dark: false });
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const f = puffs[i], age = t - f.t0;
      if (age < 0) continue;
      if (age > f.life) { puffs.splice(i, 1); continue; }
      const k = age / f.life;
      ctx.fillStyle = f.dark ? `rgba(30,30,34,${0.55 * (1 - k)})` : `rgba(220,226,235,${0.35 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y - f.up * (age / 1000), f.r * (1 + k * 2.4), 0, Math.PI * 2); ctx.fill();
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i], step = (1500 * dt) / 1000;
      b.x += (b.vx * dt) / 1000; b.y += (b.vy * dt) / 1000; b.left -= step;
      if (b.left <= 0) { impact(b.ax, b.ay, t); bullets.splice(i, 1); continue; }
      ctx.strokeStyle = "rgba(255,226,140,.95)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - (b.vx / 1500) * 26, b.y - (b.vy / 1500) * 26); ctx.stroke();
    }

    // explosions
    for (let i = booms.length - 1; i >= 0; i--) {
      const e = booms[i], age = t - e.t0;
      if (age < 0) continue;
      if (age > e.dur) { booms.splice(i, 1); continue; }
      const k = age / e.dur, r = e.r * (0.35 + 0.65 * Math.sqrt(k));
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(255,250,210,${1 - k})`);
      g.addColorStop(0.35, `rgba(255,170,60,${0.9 * (1 - k)})`);
      g.addColorStop(0.75, `rgba(220,60,20,${0.55 * (1 - k)})`);
      g.addColorStop(1, "rgba(120,20,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
    }

    // sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const f = sparks[i], age = t - f.t0;
      if (age > f.life) { sparks.splice(i, 1); continue; }
      const sec = age / 1000;
      const sx = f.x + f.vx * sec, sy = f.y + f.vy * sec + 520 * sec * sec;
      ctx.fillStyle = `rgba(255,${Math.floor(210 - 120 * (age / f.life))},70,${1 - age / f.life})`;
      ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }

    drawA10(ctx, px, py, dir, s, firing, t);

    // screen shake around the big hit
    if (t >= boomAt && t < boomAt + 520) {
      const a = 9 * (1 - (t - boomAt) / 520);
      shake(rnd(-a, a), rnd(-a, a));
    } else shake(0, 0);

    if (t < end) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); shake(0, 0); done(); }
  };
  requestAnimationFrame(frame);
}
