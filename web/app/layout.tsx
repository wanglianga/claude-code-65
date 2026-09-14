import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '社区法律援助预约与案件分流平台',
  description: '城市社区法律援助预约、资格初审、案件分流与协同服务平台',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
