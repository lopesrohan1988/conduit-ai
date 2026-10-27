import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConduitAI | Hardware Data Diode Sizing & Zero-Downtime Cutover",
  description:
    "Automated OT Network Isolation, Hardware Data Diode Sizing, SAM 3.1 Rack Inspection & Zero-Downtime Digital Twin Verification.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased selection:bg-blue-100 selection:text-blue-900">
        {children}
      </body>
    </html>
  );
}
