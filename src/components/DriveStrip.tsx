import type { Drive } from "../types";
import { fmt } from "../util";

interface Props {
  drives: Drive[];
  active: string;
  busy: boolean;
  cached: Set<string>;
  onScan: (mount: string) => void;
  onRefresh: (mount: string) => void;
  onFolder: () => void;
}

const short = (b: number) => fmt(b).replace(/ (.)B$/, "$1");
const keyOf = (p: string) => p.toLowerCase().replace(/[\\/]+$/, "");

export function DriveStrip({ drives, active, busy, cached, onScan, onRefresh, onFolder }: Props) {
  const act = keyOf(active);
  return (
    <div className="drives">
      {drives.map((d) => {
        const used = d.total - d.free;
        const p = d.total ? (used / d.total) * 100 : 0;
        const k = keyOf(d.mount);
        const on = act === k || act.startsWith(k + "\\");
        const has = cached.has(k);
        return (
          <div key={d.mount} className={"drive" + (on ? " on" : "")}>
            <button className="main" disabled={busy} onClick={() => onScan(d.mount)} title={`${d.name || "Local disk"} · ${fmt(used)} of ${fmt(d.total)}${has ? " · scanned" : ""}`}>
              <span className="dl">{d.mount.replace(/\\$/, "")}{has && <i className="dot" />}</span>
              <span className="du">{short(used)}/{short(d.total)}</span>
              <span className="meter"><i style={{ width: p + "%" }} /></span>
            </button>
            {has && <button className="re" disabled={busy} onClick={() => onRefresh(d.mount)} title="Rescan">↻</button>}
          </div>
        );
      })}
      <button className="add" disabled={busy} onClick={onFolder} title="Scan a folder">+</button>
    </div>
  );
}
