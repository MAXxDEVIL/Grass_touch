import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorker } from "../components/ServiceWorker";
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
  title: "Impostor Hunt",
  description:
    "Real-time location-based social deduction. Five players, one impostor, one neighbourhood.",
};

export const viewport: Viewport = {
  themeColor: "#0B0F14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions (Dark Reader and friends) inject attributes onto
    // <html> before hydration. This silences the warning for that element only.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ServiceWorker />
        {children}
      </body>
    </html>
  );
}
