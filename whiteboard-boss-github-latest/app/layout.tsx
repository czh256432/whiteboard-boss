import type { Metadata } from "next";
import "./globals.css";
import "./minimal.css";

export const metadata: Metadata = {
  title: "白板BOSS · AI漫剧人才管理",
  description: "用生产能力、成长速度与管理成本，做出有数据依据的人才留用决策。",
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
      <body>{children}</body>
    </html>
  );
}
