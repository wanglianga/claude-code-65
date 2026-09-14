'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ErrorBox, Loading, Nav, OkBox } from '../components'
import { api, getUser, SessionUser } from '../lib'

export default function LawyersPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [lawyers, setLawyers] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLawyers(await api('/users/lawyers'))
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    if (!['STAFF', 'ADMIN', 'JUDICIAL', 'LAWYER'].includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return null
  const canManage = ['STAFF', 'ADMIN'].includes(user.role)

  async function toggleLeave(lawyer: any) {
    setError(null); setOk(null)
    const onLeave = !lawyer.onLeave
    let reason: string | undefined
    if (onLeave) {
      const input = prompt('请假原因（将自动生成重新指派任务）', '临时请假')
      if (input === null) return
      reason = input
    }
    try {
      const res = await api(`/users/${lawyer.id}/leave`, { method: 'POST', body: JSON.stringify({ onLeave, reason }) })
      setOk(onLeave ? `已登记请假，${res.affectedCases} 个在办案件已生成重新指派任务` : '已销假返岗')
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>值班律师管理</h1>
        <ErrorBox error={error} />
        <OkBox text={ok} />
        {!lawyers ? <Loading /> : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>律师</th><th>律所</th><th>在办案件</th><th>累计工时</th><th>值班状态</th><th>操作</th></tr></thead>
              <tbody>
                {lawyers.map((l) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.name}</td>
                    <td className="muted">{l.organization || '—'}</td>
                    <td>{l.activeCases}</td>
                    <td>{l.totalHours} 小时</td>
                    <td>
                      {l.onLeave
                        ? <><span className="badge badge-orange">请假中</span> <span className="muted" style={{ fontSize: 12 }}>{l.leaveReason}</span></>
                        : <span className="badge badge-green">在岗</span>}
                    </td>
                    <td>
                      {(canManage || user.id === l.id) && (
                        <button className="btn btn-sm" onClick={() => toggleLeave(l)}>
                          {l.onLeave ? '销假返岗' : '登记请假'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          说明：律师临时请假后，系统会自动为其名下在办案件生成「重新指派」任务，提醒社区工作人员及时改派其他值班律师，避免服务中断。
        </p>
      </div>
    </>
  )
}
