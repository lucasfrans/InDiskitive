import { useState } from "react";

interface Props {
  elevated: boolean;
  packaged: boolean;
  onElevate: () => Promise<string | null>;
  onDone: () => void;
}

export function Intro({ elevated, packaged, onElevate, onDone }: Props) {
  const [err, setErr] = useState("");

  return (
    <div className="intro">
      <div className="card">
        <h1>InDiskitive</h1>
        <p className="tag">See where your disk space went.</p>

        {elevated ? (
          <p className="q">Admin mode is on. Scans read the NTFS table directly.</p>
        ) : packaged ? (
          <>
            <p className="q">For much faster scans, right-click InDiskitive in Start and choose Run as administrator. Works without it, just slower.</p>
            <div className="btns"><button className="go" onClick={onDone}>Start</button></div>
          </>
        ) : (
          <>
            <p className="q">Run as admin? Scans read the NTFS table directly and finish much faster. Asked once.</p>
            <div className="btns">
              <button onClick={onDone}>Not now</button>
              <button
                className="go"
                onClick={async () => {
                  onDone(); // remember the answer before the app restarts
                  const e = await onElevate();
                  if (e) setErr(e);
                }}
              >
                Restart as admin
              </button>
            </div>
            {err && <p className="e">{err}</p>}
          </>
        )}
        {elevated && <div className="btns"><button className="go" onClick={onDone}>Start</button></div>}

        <p className="by">Made by Lucas Fransen</p>
      </div>
    </div>
  );
}
