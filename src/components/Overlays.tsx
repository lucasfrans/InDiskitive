import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Drive } from "../types";
import { fmt } from "../util";

export function ScanOverlay({ path, onAbort }: { path: string; onAbort: () => void }) {
  const [p, setP] = useState({ files: 0, dirs: 0, bytes: 0 });
  useEffect(() => {
    const un = listen<typeof p>("scan-progress", (e) => setP(e.payload));
    return () => { un.then((f) => f()); };
  }, []);
  return (
    <div className="overlay scan">
      <div className="path">{path}</div>
      <div className="big">{fmt(p.bytes)}</div>
      <div className="sub">{p.files.toLocaleString()} files</div>
      <button onClick={onAbort}>Cancel <kbd>esc</kbd></button>
    </div>
  );
}

export function Welcome({ drives, onScan, onBack }: { drives: Drive[]; onScan: (m: string) => void; onBack: (() => void) | null }) {
  return (
    <div className="overlay welcome">
      <table>
        <thead><tr><th>Volume</th><th>Used</th><th>Free</th><th>Size</th><th></th></tr></thead>
        <tbody>
          {drives.map((d) => (
            <tr key={d.mount} onClick={() => onScan(d.mount)}>
              <td>{d.mount.replace(/\\$/, "")} <small>{d.name}</small></td>
              <td>{fmt(d.total - d.free)}</td>
              <td>{fmt(d.free)}</td>
              <td>{fmt(d.total)}</td>
              <td><span className="meter wide"><i style={{ width: (d.total ? ((d.total - d.free) / d.total) * 100 : 0) + "%" }} /></span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Pick a volume. <kbd>/</kbd> for commands.</p>
      <p className="credit">InDiskitive by Lucas Fransen</p>
      {onBack && <button onClick={onBack}>Back</button>}
    </div>
  );
}
