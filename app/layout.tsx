import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const metadata: Metadata = {
  metadataBase: new URL(
    productionHost ? `https://${productionHost}` : "http://localhost:3000",
  ),
  title: "Debt Clock — U.S. National Debt Tracker",
  description:
    "Track the latest official U.S. national debt, daily changes, composition, and market context using U.S. Treasury Fiscal Data.",
  openGraph: {
    title: "Debt Clock — U.S. National Debt Tracker",
    description: "The U.S. debt, down to the dollar. Official daily Treasury data.",
    type: "website",
    images: [{ url: "/og.png", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Debt Clock — U.S. National Debt Tracker",
    description: "The U.S. debt, down to the dollar. Official daily Treasury data.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#090b09",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
