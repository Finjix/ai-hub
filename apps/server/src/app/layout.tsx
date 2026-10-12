import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Hub 管理中心",
  description: "AI Hub 技能库与桌面端更新管理",
  icons: "/icon.png",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
