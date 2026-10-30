import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Data, Drive, N, Quota, ScanResult } from "./types";
import { inSubtree, parseSize } from "./util";
import { buildPlans } from "./planner";
import { Treemap } from "./components/Treemap";
import { TreeIndex } from "./components/TreeIndex";
import { DriveStrip } from "./components/DriveStrip";
import { CommandLine } from "./components/CommandLine";
import { QuotaPanel } from "./components/QuotaPanel";
import { StatusBar } from "./components/StatusBar";
import { ScanOverlay, Welcome } from "./components/Overlays";
import { Intro } from "./components/Intro";

const INTRO_KEY = "indiskitive.intro";
interface Snap { data: Data; view: N | null; sel: N | null; expanded: Set<N>; quota: Quota | null }
const keyOf = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");
const link = (n: N, parent?: N) => { n.p = parent; for (const c of n.c ?? []) link(c, n); };

export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<N | null>(null);
  const [sel, setSel] = useState<N | null>(null);
  const [expanded, setExpanded] = useState<Set<N>>(new Set());
  const [scanning, setScanning] = useState<string | null>(null);
  const [home, setHome] = useState(true);
  const [tab, setTab] = useState<"index" | "quota">("index");
  const [cat, setCat] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [elevated, setElevated] = useState(false);
  const [packaged, setPackaged] = useState(false);
  const [msg, setMsg] = useState("");
  const [intro, setIntro] = useState(false);
  const [revealTok, setRevealTok] = useState(0);
  const lastPath = useRef("");
  const scanId = useRef(0);
  const msgTimer = useRef(0);

  const say = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(""), 6000);
  }, []);

  const loadDrives = useCallback(() => invoke<Drive[]>("drives").then(setDrives).catch(() => {}), []);
  useEffect(() => {
    loadDrives();
    invoke<boolean>("packaged").then(setPackaged);
    invoke<boolean>("elevated").then((v) => {
      setElevated(v);
      let seen = false;
      try { seen = localStorage.getItem(INTRO_KEY) === "1"; } catch { /* ignore */ }
      setIntro(!seen);
    });
  }, [loadDrives]);
  const finishIntro = useCallback(() => {
    try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* ignore */ }
    setIntro(false);
  }, []);

  // Finished scans stay in memory so switching drives is instant; refresh re-pulls.
  const cache = useRef(new Map<string, Snap>());
  const [cached, setCached] = useState<Set<string>>(new Set());
  const live = useRef({ data, view, sel, expanded, quota });
  live.current = { data, view, sel, expanded, quota };

  const remember = useCallback(() => {
    const l = live.current;
    if (!l.data) return;
    const k = keyOf(l.data.path);
    cache.current.set(k, { data: l.data, view: l.view, sel: l.sel, expanded: l.expanded, quota: l.quota });
    setCached((s) => (s.has(k) ? s : new Set(s).add(k)));
  }, []);

  const startScan = useCallback(async (path: string, force = false) => {
    remember();
    const hit = !force ? cache.current.get(keyOf(path)) : undefined;
    if (hit) {
      scanId.current++;
      lastPath.current = path;
      setData(hit.data); setView(hit.view); setSel(hit.sel); setExpanded(hit.expanded); setQuota(hit.quota);
      setCat(null); setHome(false); setScanning(null);
      return;
    }
    const id = ++scanId.current;
    lastPath.current = path;
    setScanning(path);
    try {
      const res = await invoke<ScanResult>("scan", { path });
      if (id !== scanId.current) return;
      link(res.root);
      const d: Data = {
        root: res.root, exts: res.exts, path,
        meta: `${res.mode === "mft" ? "mft" : "walk"} ${(res.elapsedMs / 1000).toFixed(1)}s`,
      };
      const ex = new Set([res.root]);
      cache.current.set(keyOf(path), { data: d, view: res.root, sel: null, expanded: ex, quota: null });
      setCached((s) => new Set(s).add(keyOf(path)));
      setData(d);
      setView(res.root);
      setSel(null);
      setExpanded(ex);
      setQuota(null);
      setCat(null);
      setHome(false);
      setScanning(null);
      if (res.fallback) say(`Fast scan unavailable (${res.fallback}). Used walk.`);
    } catch (err) {
      if (id !== scanId.current) return;
      setScanning(null);
      if (String(err) !== "cancelled") say(`Scan failed: ${String(err)}`);
    }
  }, [say]);

  const cancelScan = useCallback(() => {
    scanId.current++;
    invoke("cancel_scan");
    setScanning(null);
  }, []);

  const pickFolder = useCallback(async () => {
    const p = await open({ directory: true, multiple: false });
    if (typeof p === "string") startScan(p);
  }, [startScan]);

  const zoom = useCallback((n: N) => {
    setView(n);
    setExpanded((s) => new Set(s).add(n));
    setSel((s) => (s && inSubtree(s, n) ? s : null));
    setHome(false);
  }, []);
  const up = useCallback(() => { if (view?.p) zoom(view.p); }, [view, zoom]);

  const select = useCallback((n: N, fromTree = false) => {
    setSel(n);
    if (data && view && !inSubtree(n, view)) setView(data.root);
    setExpanded((s) => {
      const t = new Set(s);
      for (let c = n.p; c; c = c.p) t.add(c);
      return t;
    });
    if (!fromTree) setRevealTok((t) => t + 1);
    setHome(false);
  }, [data, view]);

  const toggle = useCallback((n: N) => setExpanded((s) => { const t = new Set(s); t.has(n) ? t.delete(n) : t.add(n); return t; }), []);

  const reveal = useCallback((path: string) => { invoke("reveal", { path }); }, []);

  const issue = useCallback((bytes: number) => {
    if (!data) { say("Scan a volume first."); return; }
    const plans = buildPlans(data.root, bytes);
    const checked: Quota["checked"] = {};
    for (const p of plans) checked[p.id] = new Set(p.items.map((i) => i.node));
    // open on the first plan that can cover the target, else the biggest
    
    setQuota({ target: bytes, plans, active: plans[0].id, checked });
    setTab("quota");
  }, [data, say]);

  const toggleItem = useCallback((n: N) => setQuota((q) => {
    if (!q) return q;
    const s = new Set(q.checked[q.active]);
    s.has(n) ? s.delete(n) : s.add(n);
    return { ...q, checked: { ...q.checked, [q.active]: s } };
  }), []);

  const elevate = useCallback(async () => {
    try { await invoke("relaunch_admin"); return null; } catch (e) { return String(e); }
  }, []);

  const command = useCallback((line: string) => {
    const t = line.trim();
    const low = t.toLowerCase();
    let m: RegExpExecArray | null;
    if ((m = /^(?:free|clear|quota)\s+(.+)$/i.exec(t))) {
      const b = parseSize(m[1]);
      return b ? issue(b) : say(`Bad size "${m[1]}". Try: free 120gb`);
    }
    const bare = parseSize(t);
    if (bare) return issue(bare);
    if ((m = /^scan\s+(.+)$/i.exec(t))) return startScan(m[1].replace(/^"|"$/g, ""));
    if (low === "refresh" || low === "rescan") return data ? void startScan(data.path, true) : say("Nothing to refresh");
    if (low === "up" || low === "cd ..") return up();
    if ((m = /^cd\s+(.+)$/i.exec(t))) {
      const want = m[1].toLowerCase();
      const kids = (view?.c ?? []).filter((c) => c.k === 0);
      const hit = kids.find((c) => c.n.toLowerCase() === want) ?? kids.find((c) => c.n.toLowerCase().startsWith(want));
      return hit ? zoom(hit) : say(`No folder "${m[1]}" here`);
    }
    if (low === "drives" || low === "home") return setHome(true);
    if (low === "elevate") return void elevate().then((e) => e && say(e.toUpperCase()));
    
    say(`Unknown. Try: free 120gb · scan d:\\ · cd · up · refresh`);
  }, [issue, startScan, up, view, data, zoom, elevate, say]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === "INPUT";
      if (e.key === "Escape" && scanning) cancelScan();
      else if (e.key === "Escape" && !typing) setSel(null);
      else if ((e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) && !typing) { e.preventDefault(); up(); }
      else if (e.key === "Enter" && !typing && sel?.k === 0) zoom(sel);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [scanning, cancelScan, up, sel, zoom]);

  const marked = useMemo(() => (tab === "quota" && quota ? quota.checked[quota.active] : null), [tab, quota]);
  const showWelcome = !scanning && (home || !data);

  return (
    <div className="app">
      <header className="top">
        <button className="brand" onClick={() => setHome(true)} title="Volumes">InDiskitive</button>
        <DriveStrip drives={drives} active={data?.path ?? ""} busy={!!scanning} cached={cached} onScan={(m) => startScan(m)} onRefresh={(m) => startScan(m, true)} onFolder={pickFolder} />
      </header>
      <CommandLine view={view} msg={msg} onNavigate={zoom} onCommand={command} />
      <main className="main">
        <aside className="side">
          <div className="tabs">
            <button className={tab === "index" ? "on" : ""} onClick={() => setTab("index")}>Tree</button>
            <button className={tab === "quota" ? "on" : ""} onClick={() => setTab("quota")}>Free</button>
          </div>
          {tab === "index" ? (
            view ? <TreeIndex view={view} sel={sel} expanded={expanded} revealTok={revealTok} onToggle={toggle} onSelect={(n) => select(n, true)} onZoom={zoom} />
              : <div className="empty">No data</div>
          ) : (
            <QuotaPanel quota={quota} onIssue={issue} onPlan={(id) => setQuota((q) => (q ? { ...q, active: id } : q))} onToggle={toggleItem} onLocate={(n) => select(n)} onReveal={reveal} />
          )}
        </aside>
        <section className="stage">
          {view && <Treemap view={view} sel={sel} marked={marked} cat={cat} onSelect={(n) => select(n)} onZoom={zoom} onUp={up} />}
          {scanning && <ScanOverlay path={scanning} onAbort={cancelScan} />}
          {showWelcome && <Welcome drives={drives} onScan={startScan} onBack={data ? () => setHome(false) : null} />}
        </section>
      </main>
      {intro && <Intro elevated={elevated} packaged={packaged} onElevate={elevate} onDone={finishIntro} />}
      <StatusBar data={data} view={view} sel={sel} cat={cat} onCat={setCat} elevated={elevated} packaged={packaged} onElevate={elevate} onReveal={reveal} />
    </div>
  );
}
