// Server component. Collapsible card showing a tool call's name, args, result.
// No deps beyond React.

type Props = {
  name: string;
  args: unknown;
  result?: unknown;
};

export default function ToolCallCard({ name, args, result }: Props) {
  return (
    <details
      style={{
        border: "1px solid #ddd",
        borderRadius: 4,
        padding: "6px 8px",
        margin: "6px 0",
        background: "#fafafa",
        fontSize: 13,
      }}
    >
      <summary style={{ cursor: "pointer", fontFamily: "monospace" }}>
        tool: {name}
      </summary>
      <div style={{ marginTop: 6 }}>
        <div style={{ color: "#555" }}>args</div>
        <pre style={{ margin: "2px 0 8px", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(args, null, 2)}
        </pre>
        {result !== undefined && (
          <>
            <div style={{ color: "#555" }}>result</div>
            <pre style={{ margin: "2px 0", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}
