'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav } from '../components'
import {
  api, CATEGORY_LABELS, fmtDate, getUser, priorityBadge, PRIORITY_LABELS, riskBadge, RISK_LABELS,
  SOURCE_LABELS, specialFlags, statusBadge, STATUS_LABELS, TIMELINESS_LABELS, timelinessBadge,
  TYPE_LABELS, INTENT_LABELS, SessionUser,
} from '../lib'

export default function CasesPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [cases, setCases] = useState<any[] | null>(null)
  const [risks, setRisks] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ status: '', type: '', special: '', search: '' })

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams()
      Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v))
      const data = await api(`/cases?${qs.toString()}`)
      setCases(data)
    } catch (err: any) {
      setError(err.message)
    }
  }, [filters])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  // 工作人员/司法所/管理员：加载期限风险预警（首页置顶，避免紧急案件被淹没）
  useEffect(() => {
    if (user && ['STAFF', 'ADMIN', 'JUDICIAL'].includes(user.role)) {
      api('/cases/deadline-risks').then(setRisks).catch(() => setRisks([]))
    }
  }, [user])

  if (!user) return null
  const canCreate = ['RESIDENT', 'STAFF', 'ADMIN'].includes(user.role)
  const titles: Record<string, string> = {
    RESIDENT: '我的案件', LAWYER: '案件池（可接案 + 我承办的）', STAFF: '案件分流列表',
    ADMIN: '案件列表', JUDICIAL: '案件列表', VOLUNTEER: '与我相关的案件',
  }

  return (
    <>
      <Nav />
      <div className="container">
        <div className="flex-between">
          <h1 style={{ fontSize: 20, margin: 0 }}>{titles[user.role] || '案件列表'}</h1>
          {canCreate && (
            <Link href="/cases/new" className="btn btn-primary">
              {user.role === 'RESIDENT' ? '+ 提交咨询' : '+ 线下补录 / 代录'}
            </Link>
          )}
        </div>

        <div className="card mt16">
          <div className="row">
            <select className="input" style={{ width: 150 }} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" style={{ width: 150 }} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">全部类型</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" style={{ width: 170 }} value={filters.special} onChange={(e) => setFilters({ ...filters, special: e.target.value })}>
              <option value="">特殊情形</option>
              <option value="dv">家庭暴力</option>
              <option value="wage">欠薪群体</option>
              <option value="elderly">老人赡养</option>
              <option value="minor">涉未成年人</option>
            </select>
            <input className="input" style={{ width: 220 }} placeholder="搜索案号/标题/申请人" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            <button className="btn" onClick={load}>查询</button>
          </div>
        </div>

        <ErrorBox error={error} />

        {/* ---------- 期限风险预警（工作人员首页置顶） ---------- */}
        {risks && risks.length > 0 && (
          <div className="card mt16" style={{ borderColor: 'var(--red)', borderWidth: 2 }}>
            <h2 style={{ borderLeftColor: 'var(--red)' }}>⏰ 期限风险预警（{risks.length} 件需优先处理）</h2>
            <table className="table">
              <thead>
                <tr><th>风险</th><th>案件</th><th>剩余期限</th><th>证据</th><th>居民意愿</th><th>最近提醒</th></tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/cases/${r.id}`)}>
                    <td><Badge text={RISK_LABELS[r.risk.level]} cls={riskBadge(r.risk.level)} /></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.caseNo} · {TYPE_LABELS[r.type]} · {r.applicantName}</div>
                    </td>
                    <td>
                      {r.risk.daysLeft !== null ? (
                        r.risk.daysLeft < 0
                          ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>已逾期 {-r.risk.daysLeft} 天</span>
                          : <span style={{ color: r.risk.daysLeft <= 30 ? 'var(--red)' : 'var(--orange)', fontWeight: 600 }}>剩 {r.risk.daysLeft} 天</span>
                      ) : '—'}
                      <div className="muted" style={{ fontSize: 12 }}>{fmtDate(r.risk.deadline)}</div>
                    </td>
                    <td className="muted">{r.evidence.verified}/{r.evidence.total} 已核验</td>
                    <td>{r.residentIntent ? <Badge text={INTENT_LABELS[r.residentIntent]} cls="badge-blue" /> : <span className="muted">未登记</span>}</td>
                    <td>
                      {r.lastReminder
                        ? <Badge text={TIMELINESS_LABELS[r.lastReminder.timeliness]} cls={timelinessBadge(r.lastReminder.timeliness)} />
                        : <span className="muted">未提醒</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!cases ? <Loading /> : cases.length === 0 ? <Empty text="暂无案件" /> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>案号 / 标题</th>
                  <th>类型</th>
                  <th>申请人</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>优先级</th>
                  <th>特殊情形</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/cases/${c.id}`)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.caseNo}</div>
                    </td>
                    <td>{TYPE_LABELS[c.type]}</td>
                    <td>{c.applicantName}</td>
                    <td>{SOURCE_LABELS[c.source]}</td>
                    <td><Badge text={STATUS_LABELS[c.status]} cls={statusBadge(c.status)} /></td>
                    <td><Badge text={PRIORITY_LABELS[c.priority]} cls={priorityBadge(c.priority)} /></td>
                    <td>
                      {specialFlags(c).map((f) => <Badge key={f} text={f} cls="badge-red" />)}
                      {['MEDIUM', 'HIGH', 'EXPIRED'].includes(c.deadlineRisk) && (
                        <Badge text={`⏰${RISK_LABELS[c.deadlineRisk]}`} cls={riskBadge(c.deadlineRisk)} />
                      )}
                      &nbsp;
                    </td>
                    <td className="muted">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
