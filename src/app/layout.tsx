import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "UNGRANT",
  description: "See and revoke ERC-20 token approvals on Robinhood Chain. Your wallet stays in your control.",
  applicationName: "UNGRANT",
  openGraph: {
    title: "UNGRANT",
    description: "A clear view of your onchain permissions on Robinhood Chain.",
    siteName: "UNGRANT",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#080a08",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
