'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav } from '../components'
import { api, fmtDate, getUser, priorityBadge, PRIORITY_LABELS, SessionUser, TASK_STATUS_LABELS, TASK_TYPE_LABELS, taskStatusBadge } from '../lib'

export default function TasksPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [tasks, setTasks] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setTasks(await api('/tasks/mine'))
    } catch (err: any) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  if (!user) return null

  async function setStatus(id: string, status: string) {
    setError(null)
    try {
      await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const open = (tasks || []).filter((t) => t.status !== 'DONE')
  const done = (tasks || []).filter((t) => t.status === 'DONE')

  const renderRow = (t: any) => (
    <tr key={t.id}>
      <td>
        <div style={{ fontWeight: 600 }}>{t.title}</div>
        {t.description && <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>}
        <div className="muted" style={{ fontSize: 12 }}>
          案件：<Link href={`/cases/${t.case.id}`}>{t.case.caseNo} {t.case.title}</Link>
        </div>
      </td>
      <td>{TASK_TYPE_LABELS[t.type]}</td>
      <td><Badge text={PRIORITY_LABELS[t.case.priority]} cls={priorityBadge(t.case.priority)} /></td>
      <td className="muted">{fmtDate(t.dueDate)}</td>
      <td><Badge text={TASK_STATUS_LABELS[t.status]} cls={taskStatusBadge(t.status)} /></td>
      <td>
        {t.status !== 'DONE' && (
          <div className="btn-row" style={{ marginTop: 0 }}>
            {t.status === 'OPEN' && <button className="btn btn-sm" onClick={() => setStatus(t.id, 'IN_PROGRESS')}>开始</button>}
            <button className="btn btn-sm" onClick={() => setStatus(t.id, 'DONE')}>完成</button>
          </div>
        )}
      </td>
    </tr>
  )

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>我的待办任务</h1>
        <ErrorBox error={error} />
        {!tasks ? <Loading /> : (
          <>
            <div className="card" style={{ padding: 0 }}>
              {open.length === 0 ? <Empty text="暂无待办任务" /> : (
                <table className="table">
                  <thead><tr><th>任务 / 案件</th><th>类型</th><th>案件优先级</th><th>截止</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>{open.map(renderRow)}</tbody>
                </table>
              )}
            </div>
            {done.length > 0 && (
              <div className="card" style={{ padding: 0 }}>
                <h2 style={{ padding: '14px 20px 0' }}>已完成</h2>
                <table className="table">
                  <tbody>{done.map(renderRow)}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
