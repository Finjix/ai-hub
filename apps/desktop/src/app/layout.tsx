import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'MCC AI 工具平台', description: '团队 AI 技能库', icons: '/icon.png' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
