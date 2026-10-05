import { headers } from "next/headers";
import Chat from "@/components/Chat";

// Server component. Middleware attaches x-tenant-id + x-user-id after JWT verify.
// On a direct hit without a JWT, middleware returns 401 before we get here.
// If someone bypasses middleware (shouldn't happen), fall back to "-".

export default async function ChatPage() {
  const h = await headers();
  const tenantId = h.get("x-tenant-id") ?? "-";
  const userId = h.get("x-user-id") ?? "-";

  return (
    <main>
      <header
        style={{
          borderBottom: "1px solid #eee",
          padding: "10px 16px",
          fontSize: 13,
          color: "#555",
        }}
      >
        Enterprise Assistant Reference &mdash; tenant: <code>{tenantId}</code>, user:{" "}
        <code>{userId}</code>
      </header>
      <Chat initialTenantId={tenantId} initialUserId={userId} />
    </main>
  );
}
