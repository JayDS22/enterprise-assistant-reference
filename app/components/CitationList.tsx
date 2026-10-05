// Server component. Renders a small citation list under an assistant message.
// Links point at /docs/[docId] which 404s for now — the shape is what matters.

type Citation = { docId: string; title: string; score: number };

export default function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <ul style={{ fontSize: 12, color: "#555", margin: "6px 0 0 20px", padding: 0 }}>
      {citations.map((c) => (
        <li key={c.docId} style={{ margin: "2px 0" }}>
          <a href={`/docs/${c.docId}`} style={{ color: "#06c" }}>
            {c.title}
          </a>
          <span style={{ color: "#999" }}> &nbsp;({c.score.toFixed(2)})</span>
        </li>
      ))}
    </ul>
  );
}
