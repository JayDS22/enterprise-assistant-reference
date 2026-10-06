import "./globals.css";

export const metadata = {
  title: "Enterprise Assistant Reference",
  description: "Multi-agent reference impl: Agents SDK + Responses API + Postgres RLS.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
