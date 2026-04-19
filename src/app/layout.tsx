import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import { getSiteSettings } from "@/lib/queries";
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

export async function generateMetadata(): Promise<Metadata> {
  // Read the A&R's display name from site settings so each deployment
  // shows its owner's name in the browser tab + social previews without
  // any code changes.
  let displayName = "A&R Portfolio";
  try {
    const settings = await getSiteSettings();
    if (settings.displayName?.trim()) displayName = settings.displayName.trim();
  } catch {
    // DB unreachable during static generation — fall back to the default
    // and move on. Pages will re-fetch at request time.
  }
  const title =
    displayName === "A&R Portfolio" ? displayName : `${displayName} — A&R`;
  const description =
    "A&R portfolio & analytics. Live Spotify metrics across a curated roster of signed artists and projects.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title },
  };
}

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
