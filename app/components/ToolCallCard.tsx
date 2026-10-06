"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

type Props = { name: string; args: unknown; result?: unknown; color?: string };

export default function ToolCallCard({ name, args, result, color = "var(--color-accent)" }: Props) {
  const [open, setOpen] = useState(false);
  const argsPreview = (() => {
    try {
      const s = typeof args === "string" ? args : JSON.stringify(args);
      return s.length > 60 ? s.slice(0, 58) + "..." : s;
    } catch {
      return "";
    }
  })();

  return (
    <div
      className="rounded-md border bg-bg-input/60 overflow-hidden transition hover:bg-bg-input"
      style={{ borderColor: `color-mix(in oklch, ${color} 25%, var(--color-border))` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={12} style={{ color }} />
        <code className="font-mono text-[12px] font-medium" style={{ color }}>
          {name}
        </code>
        <code className="font-mono text-[11px] text-text-dim truncate flex-1">
          ({argsPreview})
        </code>
      </button>
      {open && (
        <div className="px-3 pb-2 pt-1 text-[11px] space-y-1.5 border-t border-border/50">
          <div>
            <div className="text-text-dim uppercase tracking-wider text-[9px] mb-0.5">args</div>
            <pre className="font-mono text-[11px] overflow-x-auto bg-bg rounded px-2 py-1.5">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <div className="text-text-dim uppercase tracking-wider text-[9px] mb-0.5">result</div>
              <pre className="font-mono text-[11px] overflow-x-auto bg-bg rounded px-2 py-1.5">
                {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
