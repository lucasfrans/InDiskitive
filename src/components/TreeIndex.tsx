import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { N } from "../types";
import { CATS, catOf, fmt } from "../util";

const ROW = 22;
const MAX_KIDS = 300;

interface Row { n: N | null; depth: number; parentSize: number; more?: number }

interface Props {
  view: N;
  sel: N | null;
  expanded: Set<N>;
  revealTok: number;
  onToggle: (n: N) => void;
  onSelect: (n: N) => void;
  onZoom: (n: N) => void;
}

function TreeIndexImpl({ view, sel, expanded, revealTok, onToggle, onSelect, onZoom }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(600);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const emit = (n: N, depth: number, parentSize: number) => {
      out.push({ n, depth, parentSize });
      if (n.k === 0 && n.c?.length && expanded.has(n)) {
        const lim = Math.min(n.c.length, MAX_KIDS);
        for (let i = 0; i < lim; i++) emit(n.c[i], depth + 1, n.s);
        if (n.c.length > lim) out.push({ n: null, depth: depth + 1, parentSize: 0, more: n.c.length - lim });
      }
    };
    emit(view, 0, view.s);
    return out;
  }, [view, expanded]);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!sel || !revealTok) return;
    const i = rows.findIndex((r) => r.n === sel);
    const el = box.current;
    if (i < 0 || !el) return;
    const y = i * ROW;
    if (y < el.scrollTop || y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTok]);

  const first = Math.max(0, Math.floor(top / ROW) - 6);
  const last = Math.min(rows.length, Math.ceil((top + h) / ROW) + 6);

  return (
    <div className="index" ref={box} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: rows.length * ROW, position: "relative" }}>
        {rows.slice(first, last).map((r, k) => {
          const i = first + k;
          const style = { top: i * ROW, paddingLeft: 8 + r.depth * 14 };
          if (!r.n) return <div key={i} className="row more" style={style}>+{r.more} more</div>;
          const n = r.n;
          const isDir = n.k === 0 && !!n.c?.length;
          const c = catOf(n);
          const w = r.parentSize > 0 ? Math.max(0.4, (n.s / r.parentSize) * 100) : 0;
          return (
            <div
              key={i}
              className={"row" + (n === sel ? " sel" : "")}
              style={style}
              onClick={() => onSelect(n)}
              onDoubleClick={() => n.k === 0 && n !== view && onZoom(n)}
            >
              <span className="bar" style={{ width: w + "%" }} />
              <span className="chev" onClick={(e) => { if (isDir) { e.stopPropagation(); onToggle(n); } }}>
                {isDir ? (expanded.has(n) ? "−" : "+") : ""}
              </span>
              <span className="dot" style={{ background: c ? CATS[c].color : n.k === 0 ? "transparent" : "#3a4452", borderColor: c ? CATS[c].color : "#6b7686" }} />
              <span className="nm">{n.k === 2 ? `Small files (${n.f.toLocaleString()})` : n.n}</span>
              <span className="sz">{fmt(n.s)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TreeIndex = memo(TreeIndexImpl);
