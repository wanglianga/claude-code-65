'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav } from '../components'
import {
  api, fmtDateTime, getUser, priorityBadge, PRIORITY_LABELS, REFERRAL_STATUS_LABELS,
  REFERRAL_TYPE_LABELS, SessionUser, TYPE_LABELS,
} from '../lib'

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
    if (!['STAFF', 'ADMIN', 'JUDICIAL'].includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return null

  async function setStatus(id: string, status: string) {
    setError(null)
    try {
      await api(`/referrals/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>转介管理（司法所转介 / 跨街道转介 / 其他单位）</h1>
        <ErrorBox error={error} />
        {!list ? <Loading /> : list.length === 0 ? <Empty text="暂无转介记录" /> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr><th>案件</th><th>类型</th><th>从 → 到</th><th>原因</th><th>状态</th><th>时间</th><th>操作</th></tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/cases/${r.case.id}`}>{r.case.caseNo}</Link>
                      <div style={{ fontSize: 12 }}>{r.case.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{TYPE_LABELS[r.case.type]} · 申请人 {r.case.applicantName}</div>
                    </td>
                    <td>{REFERRAL_TYPE_LABELS[r.type] || r.type}</td>
                    <td>
                      <div>{r.fromStreet || '—'} → {r.toStreet || r.toUnit}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.toUnit}</div>
                    </td>
                    <td className="muted">{r.reason || '—'}</td>
                    <td>
                      <Badge text={REFERRAL_STATUS_LABELS[r.status]} cls="badge-purple" />
                      <div><Badge text={PRIORITY_LABELS[r.case.priority]} cls={priorityBadge(r.case.priority)} /></div>
                    </td>
                    <td className="muted">{fmtDateTime(r.createdAt)}</td>
                    <td>
                      {r.status === 'PENDING' && (
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          <button className="btn btn-sm" onClick={() => setStatus(r.id, 'ACCEPTED')}>接收</button>
                          <button className="btn btn-sm" onClick={() => setStatus(r.id, 'REJECTED')}>退回</button>
                        </div>
                      )}
                      {r.status === 'ACCEPTED' && (
                        <button className="btn btn-sm" onClick={() => setStatus(r.id, 'COMPLETED')}>办结</button>
                      )}
                    </td>
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
