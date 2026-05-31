import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FCA Data Portal — Demo",
  description: "Conversational AI demo for the FCA Data Portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
