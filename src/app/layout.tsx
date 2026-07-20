import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知政公考｜智能备考平台",
  description: "题库练习、模拟考试、错题复习与学习分析一体化公考辅助系统",
  applicationName: "知政公考",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "知政公考" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#172554", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
