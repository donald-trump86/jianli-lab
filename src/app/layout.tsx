import type { Metadata } from 'next';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: '见理 · 把原理变成实验',
  description: '交互探索距离度量、KNN 分类与应变电桥。拖动、观察、提问，保存每一次发现。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
