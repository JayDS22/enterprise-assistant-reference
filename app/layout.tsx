// Minimal root layout. Next 15 App Router requires a root layout to build.
// Day-1 scaffold did not ship one; added here so the chat UI can render.

export const metadata = {
  title: "Enterprise Assistant Reference",
  description: "Reference impl for Agents SDK + Responses API. Not a product.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
