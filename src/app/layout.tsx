import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "内容工作台 · 演示版",
  description: "自媒体账号运营工作流",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
