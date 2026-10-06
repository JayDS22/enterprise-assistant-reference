import { BookOpen } from "lucide-react";

type Citation = { docId: string; title: string; score: number };

export default function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="flex items-start gap-2 text-[11px] text-text-muted pl-1">
      <BookOpen size={12} className="mt-0.5 shrink-0" />
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {citations.map((c) => (
          <a
            key={c.docId}
            href={`/docs/${c.docId}`}
            className="hover:text-text underline underline-offset-2 decoration-text-dim/40"
          >
            {c.title}
            <span className="text-text-dim ml-1">· {c.score.toFixed(2)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
