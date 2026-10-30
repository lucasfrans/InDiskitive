import { useEffect, useState } from "react";
import type { N, Quota } from "../types";
import { fmt, parseSize } from "../util";

interface Props {
  quota: Quota | null;
  onIssue: (bytes: number) => void;
  onPlan: (id: string) => void;
  onToggle: (n: N) => void;
  onLocate: (n: N) => void;
  onReveal: (path: string) => void;
}

export function QuotaPanel({ quota, onIssue, onPlan, onToggle, onLocate, onReveal }: Props) {
  const [text, setText] = useState("20gb");
  // keep the box in step with plans issued from the command line
  useEffect(() => {
    if (quota) setText(`${+(quota.target / 1024 ** 3).toFixed(2)}gb`);
  }, [quota?.target]);
  const go = () => { const b = parseSize(text); if (b) onIssue(b); };

  const plan = quota?.plans.find((p) => p.id === quota.active);
  const checked = quota && plan ? quota.checked[plan.id] : null;
  const got = plan && checked ? plan.items.reduce((a, i) => a + (checked.has(i.node) ? i.size : 0), 0) : 0;
  const ratio = quota ? got / quota.target : 0;
  const diff = quota ? got - quota.target : 0;

  return (
    <div className="free">
      <div className="ask">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} spellCheck={false} placeholder="120gb" />
        <button onClick={go}>Find</button>
      </div>

      {!quota && <p className="hint">Amount to free. Shows the fewest items that clear it.</p>}

      {quota && plan && checked && (
        <>
          <div className="sum">
            <div className="nums">
              <b>{fmt(got)}</b>
              <span>{diff >= 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}`} of {fmt(quota.target)}</span>
            </div>
            <div className={"bar" + (ratio >= 1 ? " met" : "")}><i style={{ width: Math.min(100, ratio * 100) + "%" }} /></div>
          </div>

          <div className="opts">
            {quota.plans.map((p) => (
              <button key={p.id} className={p.id === quota.active ? "on" : ""} onClick={() => onPlan(p.id)}>
                {p.name}<small>{p.items.length} · {fmt(p.total)}</small>
              </button>
            ))}
          </div>
          {plan.total < quota.target && <div className="warn">Only {fmt(plan.total)} found. Scan a wider root.</div>}

          <div className="items">
            {plan.items.map((it) => (
              <div key={it.path} className={"item" + (checked.has(it.node) ? " on" : "")}>
                <button className="box" onClick={() => onToggle(it.node)} aria-label="include">{checked.has(it.node) ? "◼" : "◻"}</button>
                <div className="info" onClick={() => onLocate(it.node)} title={it.path}>
                  <div className="ip">{it.path}</div>
                  <div className="iw">
                    <span className={it.risk}>{it.risk}</span>
                    {it.unit && <span> · {it.unit}</span>} · {it.why}
                  </div>
                </div>
                <div className="isz">{fmt(it.size)}</div>
                <button className="mini" onClick={() => onReveal(it.path)} title="Show in Explorer">↗</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
