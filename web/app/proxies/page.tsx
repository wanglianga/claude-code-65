'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav } from '../components'
import {
  api, fmtDateTime, getUser, PROXY_METHOD_LABELS, PROXY_STATUS_LABELS, proxyStatusBadge,
  SessionUser, TYPE_LABELS,
} from '../lib'

export default function ProxiesPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setList(await api('/material-proxies'))
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    if (!['VOLUNTEER', 'STAFF', 'ADMIN', 'RESIDENT', 'JUDICIAL'].includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return null
  const isVolunteer = user.role === 'VOLUNTEER'
  const isStaff = ['STAFF', 'ADMIN'].includes(user.role)
  const isOwner = (p: any) => user.role === 'RESIDENT' && p.case.residentId === user.id

  async function act(fn: () => Promise<any>, ok: string) {
    setError(null)
    try { await fn(); setError(null); await load() } catch (e: any) { setError(e.message) }
    void ok
  }

  async function claim(p: any) {
    const t = prompt('预约上门时间（YYYY-MM-DD HH:MM）')
    if (!t) return
    await act(
      () => api(`/material-proxies/${p.id}/claim`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(t.replace(' ', 'T')).toISOString() }) }),
      '已认领并预约',
    )
  }
  async function stage(p: any, s: string, withPurpose = false) {
    let body: any = {}
    if (withPurpose) {
      const purpose = prompt('材料用途（随完成告知居民）', p.purpose || '用于本案件法律援助办理与举证')
      if (purpose === null) return
      body = { purpose }
    }
    await act(() => api(`/material-proxies/${p.id}/stage/${s}`, { method: 'POST', body: JSON.stringify(body) }), '已登记')
  }
  async function confirm(p: any) {
    await act(() => api(`/material-proxies/${p.id}/confirm`, { method: 'POST', body: JSON.stringify({ purpose: p.purpose }) }), '已确认，用途说明与销毁提醒已送达')
  }

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>材料线下代传（志愿者上门拍照 / 扫描 / 代交复印件）</h1>
        <div className="alert alert-blue">
          老人或残障居民无法线上上传证据时，由志愿者预约上门代传。涉及原件需依次登记「取走 → 拍照/扫描 → 归还 → 居民确认」时间；
          代传完成后向居民送达材料用途说明与销毁/返还提醒，律师端证据状态同步更新。
        </div>
        <ErrorBox error={error} />
        {!list ? <Loading /> : list.length === 0 ? <Empty text="暂无代传记录" /> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr><th>案件</th><th>材料</th><th>方式/原件</th><th>志愿者</th><th>流转时间</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const mine = isVolunteer && p.volunteerId === user.id
                  const canVol = mine || isStaff
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/cases/${p.case.id}`}>{p.case.caseNo}</Link>
                        <div className="muted" style={{ fontSize: 12 }}>{p.case.title}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.materialName}</div>
                        {p.reason && <div className="muted" style={{ fontSize: 12 }}>{p.reason}</div>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <Badge text={PROXY_METHOD_LABELS[p.method]} cls="badge-blue" />
                        <div>{p.involvesOriginal ? '涉及原件' : '不带走原件'}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {p.volunteer ? p.volunteer.name : <span className="muted">待认领</span>}
                        <div className="muted">{p.scheduledAt ? fmtDateTime(p.scheduledAt) : '未预约'}</div>
                      </td>
                      <td style={{ fontSize: 12 }} className="muted">
                        {p.pickedUpAt && <div>取走：{fmtDateTime(p.pickedUpAt)}</div>}
                        {p.scannedAt && <div>扫描：{fmtDateTime(p.scannedAt)}</div>}
                        {p.returnedAt && <div>归还：{fmtDateTime(p.returnedAt)}</div>}
                        {p.residentConfirmedAt && <div>确认：{fmtDateTime(p.residentConfirmedAt)}</div>}
                        {!p.residentConfirmedAt && <div>—</div>}
                      </td>
                      <td><Badge text={PROXY_STATUS_LABELS[p.status]} cls={proxyStatusBadge(p.status)} /></td>
                      <td>
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          {p.status === 'REQUESTED' && isVolunteer && !p.volunteerId && (
                            <button className="btn btn-sm btn-primary" onClick={() => claim(p)}>认领并预约</button>
                          )}
                          {p.involvesOriginal && p.status === 'ASSIGNED' && canVol && (
                            <button className="btn btn-sm" onClick={() => stage(p, 'PICKED_UP')}>取走原件</button>
                          )}
                          {['ASSIGNED', 'PICKED_UP'].includes(p.status) && canVol && (
                            <button className="btn btn-sm" onClick={() => stage(p, 'SCANNED', true)}>拍照/扫描入卷</button>
                          )}
                          {p.involvesOriginal && ['PICKED_UP', 'SCANNED'].includes(p.status) && p.status !== 'RETURNED' && canVol && (
                            <button className="btn btn-sm" onClick={() => stage(p, 'RETURNED')}>归还原件</button>
                          )}
                          {['SCANNED', 'RETURNED'].includes(p.status) && (isOwner(p) || isStaff) && (
                            <button className="btn btn-sm btn-primary" disabled={p.involvesOriginal && !p.returnedAt}
                              onClick={() => confirm(p)}>居民确认</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
