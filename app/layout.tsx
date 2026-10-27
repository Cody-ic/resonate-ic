import type { Metadata } from "next";
import { brand } from "../lib/brand";
import "./globals.css";
import "./course-fixes.css";
import "./classification.css";
import "./community-features.css";
import "./workflows.css";
import "./workspace.css";
import "./standards.css";
import "./featured-intro.css";
import "./project-cover.css";

export const metadata: Metadata = {
  title: brand.title,
  description: brand.description,
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
