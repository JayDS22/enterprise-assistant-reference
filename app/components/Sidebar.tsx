"use client";

import { AGENT_COLORS, EXAMPLE_PROMPTS } from "@/lib/ui-constants";

export default function Sidebar() {
  return (
    <aside className="w-full md:w-72 shrink-0 border-l border-border bg-bg-elevated/50 px-5 py-5 text-sm">
      <section>
        <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2 font-semibold">
          Try a prompt
        </h2>
        <div className="flex flex-col gap-1.5">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p.label}
              data-prompt={p.text}
              className="prompt-chip text-left px-3 py-2 rounded-md bg-bg-input hover:bg-bg-input/60 border border-border hover:border-border-strong transition text-[13px] leading-snug"
            >
              {p.label}
              <span className="block text-[10px] text-text-dim mt-0.5">
                exercises {p.exercises}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2 font-semibold">
          Agents
        </h2>
        <div className="flex flex-col gap-1">
          {Object.entries(AGENT_COLORS).map(([name, color]) => (
            <div key={name} className="flex items-center gap-2 text-[12px]">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: `var(--color-agent-${name})`, boxShadow: `0 0 8px ${color}` }}
              />
              <span className="font-mono">{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 text-[11px] text-text-muted leading-relaxed">
        <h2 className="text-[11px] uppercase tracking-wider mb-2 font-semibold text-text-muted">
          Honest caveats
        </h2>
        <ul className="space-y-1 list-disc list-inside">
          <li>Reference impl, not product. 10k synthetic customers only.</li>
          <li>p95 ~5-8s (supervisor + sub-agent handoff).</li>
          <li>Fly auto-stops idle VMs. First request after idle: +3-5s.</li>
          <li>Zod validates shapes; <code className="font-mono">pg</code> parameterized queries do SQL safety.</li>
        </ul>
      </section>
    </aside>
  );
}
