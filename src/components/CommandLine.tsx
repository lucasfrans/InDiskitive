import { useEffect, useRef, useState } from "react";
import type { N } from "../types";

interface Props {
  view: N | null;
  msg: string;
  onNavigate: (n: N) => void;
  onCommand: (line: string) => void;
}

export function CommandLine({ view, msg, onNavigate, onCommand }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const hist = useRef<string[]>([]);
  const hi = useRef(-1);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === "/" || e.key === ":") && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const chain: N[] = [];
  for (let c: N | undefined = view ?? undefined; c; c = c.p) chain.unshift(c);

  return (
    <div className="cmd">
      <div className="prompt">
        {chain.length === 0 && <span className="seg dim">—</span>}
        {chain.map((n, i) => (
          <span key={i} className="seg" onClick={() => onNavigate(n)}>
            {i ? <i>\</i> : null}
            {n.n.replace(/\\$/, "") || n.n}
          </span>
        ))}
        <b>&gt;</b>
      </div>
      <input
        ref={input}
        value={text}
        spellCheck={false}
        placeholder="free 120gb · scan d:\ · cd · up"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            hist.current.unshift(text);
            hi.current = -1;
            onCommand(text);
            setText("");
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            hi.current = Math.min(hi.current + 1, hist.current.length - 1);
            if (hi.current >= 0) setText(hist.current[hi.current]);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            hi.current = Math.max(hi.current - 1, -1);
            setText(hi.current >= 0 ? hist.current[hi.current] : "");
          } else if (e.key === "Escape") {
            setText("");
            input.current?.blur();
          }
        }}
      />
      <div className="feedback">{msg}</div>
    </div>
  );
}
