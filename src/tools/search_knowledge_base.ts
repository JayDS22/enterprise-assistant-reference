import { z } from "zod";
import { withTenant } from "@/db/client";
import { SearchKnowledgeBaseArgs } from "@/schemas/tools";

// ponytail: pgvector cosine when embeddings exist, ILIKE fallback otherwise.
// Day-3 scope has no embedding backfill; naive chunking + reranker is a day-6
// job (FINAL plan §8 trade-off #2). The signature stays stable across both
// code paths so the sub-agent + evals do not change when embeddings arrive.

const KBHit = z.object({
  id: z.string(),
  title: z.string(),
  body_snippet: z.string(),
  score: z.number(),
});

const SNIPPET_LEN = 240;

export async function search_knowledge_base(
  tenantId: string,
  userId: string,
  input: z.infer<typeof SearchKnowledgeBaseArgs>,
) {
  const args = SearchKnowledgeBaseArgs.parse(input);
  return withTenant(tenantId, async (tx) => {
    const populated = await tx.query(
      "SELECT COUNT(*)::int AS n FROM docs WHERE embedding IS NOT NULL LIMIT 1",
    );
    const hasEmbeddings = (populated.rows[0]?.n ?? 0) > 0;

    // ponytail: embedding query path is wired but inert until day-6 backfill.
    // Falls through to ILIKE whenever docs.embedding IS NULL — no silent zero
    // results, no runtime branch on an env flag.
    const like = `%${args.query}%`;
    const result = hasEmbeddings
      ? await tx.query(
          `SELECT id, title, substring(body FROM 1 FOR $1) AS body_snippet,
                  1 - (embedding <=> (
                    SELECT embedding FROM docs
                     WHERE embedding IS NOT NULL
                       AND (title ILIKE $2 OR body ILIKE $2)
                     LIMIT 1
                  )) AS score
             FROM docs
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> (
              SELECT embedding FROM docs
               WHERE embedding IS NOT NULL
                 AND (title ILIKE $2 OR body ILIKE $2)
               LIMIT 1
            ) ASC
            LIMIT $3`,
          [SNIPPET_LEN, like, args.top_k],
        )
      : await tx.query(
          `SELECT id, title, substring(body FROM 1 FOR $1) AS body_snippet,
                  0.0::float AS score
             FROM docs
            WHERE title ILIKE $2 OR body ILIKE $2
            ORDER BY (CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END), id
            LIMIT $3`,
          [SNIPPET_LEN, like, args.top_k],
        );

    await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'search_knowledge_base', $3, $4)`,
      [
        tenantId,
        userId,
        JSON.stringify({ ...args, path: hasEmbeddings ? "pgvector" : "ilike" }),
        `count:${result.rowCount ?? 0}`,
      ],
    );

    return result.rows.map((r) =>
      KBHit.parse({
        id: r.id,
        title: r.title,
        body_snippet: r.body_snippet ?? "",
        score: Number(r.score ?? 0),
      }),
    );
  });
}
