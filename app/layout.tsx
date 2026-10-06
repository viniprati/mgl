import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MGL Apartamentos",
  description: "Vitrine reservada de imóveis de luxo para venda e aluguel em todo o Brasil.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
