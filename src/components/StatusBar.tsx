import { useState } from "react";
import type { Data, ExtStat, N } from "../types";
import { CATS, catOfExt, fmt, pathOf, pct } from "../util";

interface Props {
  data: Data | null;
  view: N | null;
  sel: N | null;
  cat: string | null;
  onCat: (c: string | null) => void;
  elevated: boolean;
  packaged: boolean;
  onElevate: () => Promise<string | null>;
  onReveal: (path: string) => void;
}

function legend(exts: ExtStat[]) {
  const totals: Record<string, number> = {};
  for (const e of exts) { const c = catOfExt(e.e); totals[c] = (totals[c] ?? 0) + e.b; }
  return Object.entries(CATS).filter(([k]) => totals[k]).sort((a, b) => totals[b[0]] - totals[a[0]]).map(([k, v]) => ({ k, v, b: totals[k] }));
}

export function StatusBar({ data, view, sel, cat, onCat, elevated, packaged, onElevate, onReveal }: Props) {
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState("");
  const n = sel ?? view;

  return (
    <footer className="foot">
      <div className="legend">
        {data && legend(data.exts).map(({ k, v, b }) => (
          <button key={k} className={cat === k ? "on" : ""} onClick={() => onCat(cat === k ? null : k)}>
            <i style={{ background: v.color }} />{v.label} <span>{fmt(b)}</span>
          </button>
        ))}
      </div>
      <div className="stat">
        <div className="sel">
          {data && n ? (
            <>
              <b>{n.k === 2 ? "Small files" : pathOf(n)}</b>
              <span>{fmt(n.s)}</span>
              <span>{pct(n.s, data.root.s)}</span>
              <span>{n.f.toLocaleString()} files</span>
              {n.k !== 2 && <button className="lnk" onClick={() => onReveal(pathOf(n))}>open ↗</button>}
            </>
          ) : <span>Ready</span>}
        </div>
        <div className="mode">
          {data && <span>{data.meta}</span>}
          {elevated ? <span className="ok">admin</span> : (
            <span className="elev">
              <button className="lnk" onClick={() => { setAsk((a) => !a); setErr(""); }}>elevate</button>
              {ask && (
                <div className="pop">
                  <p>{packaged ? "For much faster scans, right-click InDiskitive in Start and choose Run as administrator." : "Restart as admin for much faster scans."}</p>
                  <div>
                    <button onClick={() => setAsk(false)}>{packaged ? "Close" : "Cancel"}</button>
                    {!packaged && <button className="go" onClick={async () => { const e = await onElevate(); if (e) setErr(e); }}>Restart</button>}
                  </div>
                  {err && <p className="e">{err}</p>}
                </div>
              )}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
