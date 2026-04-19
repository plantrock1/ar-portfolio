import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "Alec Veach — A&R",
  description:
    "A&R portfolio & analytics. Live Spotify metrics across a curated roster of signed artists and projects.",
  openGraph: {
    title: "Alec Veach — A&R",
    description:
      "A&R portfolio & analytics. Live Spotify metrics across a curated roster.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Alec Veach — A&R",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="grain min-h-full flex flex-col">
        <div className="relative z-10 flex flex-col flex-1">{children}</div>
      </body>
    </html>
  );
}
