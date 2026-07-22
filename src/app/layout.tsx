import type { Metadata } from "next";
import Link from "next/link";
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

export const metadata: Metadata = {
  title: "JobPilot",
  description: "Auto-apply agent for Greenhouse, Lever and Ashby job boards",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex w-full max-w-4xl items-center gap-6 px-6 py-3 text-sm">
            <span className="font-bold tracking-tight text-zinc-900">JobPilot</span>
            <Link href="/" className="text-zinc-600 hover:text-zinc-900">
              Inspect job
            </Link>
            <Link href="/profile" className="text-zinc-600 hover:text-zinc-900">
              Profile
            </Link>
            <Link href="/applications" className="text-zinc-600 hover:text-zinc-900">
              Applications
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
