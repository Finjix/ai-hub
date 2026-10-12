import type { Metadata } from "next";
import { formatAppVersion } from "@ai-hub/shared";
import packageJson from "../../package.json";
import "./globals.css";

export const metadata: Metadata = {
  title: `AI Hub Admin ${formatAppVersion(packageJson.version)}`,
  description: "AI Hub 技能库与桌面端更新管理",
  icons: "/icon.png",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
