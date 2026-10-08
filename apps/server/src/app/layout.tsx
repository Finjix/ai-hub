import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Hub 管理中心",
  description: "管理局域网 AI 技能库与桌面端更新。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
