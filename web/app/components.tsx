'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { clearSession, getUser, ROLE_LABELS, SessionUser } from './lib'

const NAV_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  RESIDENT: [
    { href: '/cases', label: '我的案件' },
    { href: '/cases/new', label: '提交咨询' },
    { href: '/tasks', label: '我的待办' },
    { href: '/proxies', label: '材料代传' },
  ],
  STAFF: [
    { href: '/cases', label: '案件分流' },
    { href: '/cases/new', label: '线下补录' },
    { href: '/tasks', label: '协同任务' },
    { href: '/proxies', label: '材料代传' },
    { href: '/referrals', label: '转介管理' },
    { href: '/lawyers', label: '律师值班' },
    { href: '/stats', label: '统计分析' },
  ],
  LAWYER: [
    { href: '/cases', label: '案件池' },
    { href: '/tasks', label: '我的待办' },
    { href: '/lawyers', label: '请假/值班' },
  ],
  JUDICIAL: [
    { href: '/cases', label: '案件列表' },
    { href: '/referrals', label: '转介办理' },
    { href: '/tasks', label: '协同任务' },
    { href: '/proxies', label: '材料代传' },
    { href: '/stats', label: '统计分析' },
  ],
  WOMEN_FEDERATION: [
    { href: '/cases', label: '协同案件' },
    { href: '/referrals', label: '转介办理' },
    { href: '/tasks', label: '协同任务' },
  ],
  POLICE: [
    { href: '/cases', label: '协同案件' },
    { href: '/referrals', label: '转介办理' },
    { href: '/tasks', label: '协同任务' },
  ],
  VOLUNTEER: [
    { href: '/tasks', label: '我的任务' },
    { href: '/proxies', label: '上门代传' },
    { href: '/cases', label: '相关案件' },
  ],
  ADMIN: [
    { href: '/cases', label: '案件列表' },
    { href: '/cases/new', label: '线下补录' },
    { href: '/tasks', label: '协同任务' },
    { href: '/proxies', label: '材料代传' },
    { href: '/referrals', label: '转介管理' },
    { href: '/lawyers', label: '律师值班' },
    { href: '/stats', label: '统计分析' },
  ],
}

export function Nav() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const router = useRouter()
  useEffect(() => {
    setUser(getUser())
  }, [])
  if (!user) return null
  const links = NAV_BY_ROLE[user.role] || []
  return (
    <nav className="topnav">
      <span className="brand">⚖️ 社区法律援助平台</span>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="navlink">{l.label}</Link>
      ))}
      <span className="spacer" />
      <span className="who">
        {user.name}（{ROLE_LABELS[user.role] || user.role}）
        {user.onLeave && user.role === 'LAWYER' ? ' · 请假中' : ''}
      </span>
      <button
        className="logout"
        onClick={() => {
          clearSession()
          router.push('/login')
        }}
      >
        退出
      </button>
    </nav>
  )
}

export function Badge({ text, cls }: { text: string; cls?: string }) {
  return <span className={`badge ${cls || 'badge-gray'}`}>{text}</span>
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null
  return <div className="alert alert-red">{error}</div>
}

export function OkBox({ text }: { text: string | null }) {
  if (!text) return null
  return <div className="alert alert-green">{text}</div>
}

export function Loading() {
  return <div className="empty">加载中…</div>
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}
