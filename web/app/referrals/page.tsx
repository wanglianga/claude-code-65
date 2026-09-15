'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav } from '../components'
import {
  api, fmtDate, fmtDateTime, getUser, priorityBadge, PRIORITY_LABELS, REFERRAL_STATUS_LABELS,
  REFERRAL_TYPE_LABELS, ROLE_LABELS, SessionUser, TYPE_LABELS,
} from '../lib'

const UNIT_ROLES = ['STAFF', 'ADMIN', 'JUDICIAL', 'WOMEN_FEDERATION', 'POLICE']

export default function ReferralsPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setList(await api('/referrals'))
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    if (!UNIT_ROLES.includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return null
  const isStaff = ['STAFF', 'ADMIN'].includes(user.role)
  const isUnit = ['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'].includes(user.role)

  async function setStatus(id: string, status: string) {
    setError(null)
    try {
      await api(`/referrals/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function scheduleFollowUp(r: any) {
    const d = prompt('安排回访日期（YYYY-MM-DD），默认 7 天后', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
    if (!d) return
    setError(null)
    try {
      await api(`/referrals/${r.id}/follow-ups`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(d + 'T10:00').toISOString() }) })
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function completeFollowUp(r: any) {
    const pending = (r.followUps || []).find((f: any) => !f.doneAt)
    if (!pending) return
    const result = prompt('登记回访结果')
    if (!result) return
    setError(null)
    try {
      await api(`/referral-follow-ups/${pending.id}`, { method: 'PATCH', body: JSON.stringify({ result }) })
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>转介管理（司法所转介 / 跨街道转介 / 妇联·派出所家暴协同）</h1>
        <div className="alert alert-blue">
          家暴协同转介中，当事人联系方式与住址仅<b>接收人及被授权人员</b>可在案件详情查看；其他人员看到脱敏信息。接收即自动获得授权并安排 7 天后回访。
        </div>
        <ErrorBox error={error} />
        {!list ? <Loading /> : list.length === 0 ? <Empty text="暂无转介记录" /> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr><th>案件</th><th>类型</th><th>从 → 到</th><th>原因</th><th>接收/授权</th><th>回访</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/cases/${r.case.id}`}>{r.case.caseNo}</Link>
                      {r.isSafetyReferral && <div><Badge text="家暴协同" cls="badge-red" /></div>}
                      <div style={{ fontSize: 12 }}>{r.case.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{TYPE_LABELS[r.case.type]} · 申请人 {r.case.applicantName}</div>
                    </td>
                    <td>{REFERRAL_TYPE_LABELS[r.type] || r.type}</td>
                    <td>
                      <div>{r.fromStreet || '—'} → {r.toStreet || r.toUnit}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.toUnit}</div>
                    </td>
                    <td className="muted">{r.reason || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.acceptedBy ? <span>接收人：{r.acceptedBy.name}</span> : <span className="muted">待接收</span>}
                      {(r.grants || []).filter((g) => !g.revokedAt).length > 0 && (
                        <div className="muted">授权：{r.grants.filter((g) => !g.revokedAt).map((g) => g.user.name).join('、')}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {(r.followUps || []).length === 0 ? <span className="muted">—</span> : r.followUps.map((f) => (
                        <div key={f.id}>{f.doneAt ? '✓ ' : '计划 '}{fmtDate(f.scheduledAt)}{f.result ? `：${f.result}` : ''}</div>
                      ))}
                    </td>
                    <td>
                      <Badge text={REFERRAL_STATUS_LABELS[r.status]} cls="badge-purple" />
                      <div><Badge text={PRIORITY_LABELS[r.case.priority]} cls={priorityBadge(r.case.priority)} /></div>
                    </td>
                    <td>
                      {r.status === 'PENDING' && (
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          <button className="btn btn-sm" onClick={() => setStatus(r.id, 'ACCEPTED')}>接收</button>
                          <button className="btn btn-sm" onClick={() => setStatus(r.id, 'REJECTED')}>退回</button>
                        </div>
                      )}
                      {r.status === 'ACCEPTED' && (
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          {(r.followUps || []).some((f) => !f.doneAt)
                            ? <button className="btn btn-sm" onClick={() => completeFollowUp(r)}>登记回访</button>
                            : <button className="btn btn-sm" onClick={() => scheduleFollowUp(r)}>安排回访</button>}
                          {isStaff && <button className="btn btn-sm" onClick={() => setStatus(r.id, 'COMPLETED')}>办结</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isUnit && <p className="muted" style={{ fontSize: 12 }}>当前账号角色：{ROLE_LABELS[user.role]}，仅显示转介至本单位的单据。</p>}
      </div>
    </>
  )
}
