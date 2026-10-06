import Chat from "@/components/Chat";
import Sidebar from "@/components/Sidebar";
import { Database, GitBranch, ShieldCheck } from "lucide-react";

export default function ChatPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-accent/20 border border-accent/40 flex items-center justify-center text-accent font-mono text-sm font-bold">
            E
          </div>
          <div>
            <h1 className="text-sm font-medium leading-tight">enterprise-assistant-reference</h1>
            <p className="text-[11px] text-text-muted leading-tight">
              Agents SDK · Responses API · Postgres RLS · Next 15 · Fly
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-success" /> RLS enforced
          </span>
          <span className="flex items-center gap-1.5">
            <Database size={13} /> 3 tenants · 10k customers · 500 docs
          </span>
          <span className="flex items-center gap-1.5">
            <GitBranch size={13} />
            <a
              href="https://github.com/JayDS22/enterprise-assistant-reference"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text"
            >
              source
            </a>
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row gap-0 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <Chat />
        </div>
        <Sidebar />
      </div>
    </main>
  );
}
