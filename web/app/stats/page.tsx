'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ErrorBox, Loading, Nav } from '../components'
import {
  api, CATEGORY_LABELS, getUser, PRIORITY_LABELS, SessionUser, SOURCE_LABELS,
  STATUS_LABELS, TYPE_LABELS,
} from '../lib'

function BarChart({ title, data, labels }: { title: string; data: Record<string, number>; labels: Record<string, string> }) {
  const entries = Object.entries(data)
  const max = Math.max(...entries.map(([, v]) => v), 1)
  return (
    <div className="card">
      <h2>{title}</h2>
      {entries.length === 0 ? <div className="empty">暂无数据</div> : entries.map(([k, v]) => (
        <div className="bar-row" key={k}>
          <span className="bar-cap">{labels[k] || k}</span>
          <span className="bar-track"><span className="bar-fill" style={{ display: 'block', width: `${(v / max) * 100}%` }} /></span>
          <span className="bar-num">{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function StatsPage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [data, setData] = useState<any>(null)
  const [lawyers, setLawyers] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    if (!['STAFF', 'ADMIN', 'JUDICIAL'].includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
  }, [router])

  useEffect(() => {
    if (!user) return
    Promise.all([api('/stats/overview'), api('/stats/lawyers')])
      .then(([o, l]) => { setData(o); setLawyers(l) })
      .catch((err) => setError(err.message))
  }, [user])

  if (!user) return null

  return (
    <>
      <Nav />
      <div className="container">
        <h1 style={{ fontSize: 20 }}>统计分析（法律援助资源配置评估）</h1>
        <ErrorBox error={error} />
        {!data ? <Loading /> : (
          <>
            <div className="stat-cards">
              <div className="stat-card"><div className="num">{data.total}</div><div className="cap">案件总量</div></div>
              <div className="stat-card"><div className="num">{data.open}</div><div className="cap">在办案件</div></div>
              <div className="stat-card"><div className="num">{data.closed}</div><div className="cap">已结案</div></div>
              <div className="stat-card"><div className="num">{data.lawyerHoursTotal}</div><div className="cap">律师总工时（小时）</div></div>
              <div className="stat-card"><div className="num">{data.satisfactionAvg ?? '—'}</div><div className="cap">平均满意度（{data.satisfactionCount} 次评价）</div></div>
              <div className="stat-card"><div className="num">{data.avgCloseDays ?? '—'}</div><div className="cap">平均结案天数</div></div>
              <div className="stat-card"><div className="num">{data.tasksOpen}</div><div className="cap">待办协同任务</div></div>
            </div>

            <div className="card">
              <h2>特殊情形案件（需重点关注与保密/协同资源）</h2>
              <div className="stat-cards" style={{ marginBottom: 0 }}>
                <div className="stat-card"><div className="num" style={{ color: 'var(--red)' }}>{data.special.domesticViolence}</div><div className="cap">家庭暴力</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--orange)' }}>{data.special.wageArrearsGroup}</div><div className="cap">欠薪群体</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--orange)' }}>{data.special.elderlySupport}</div><div className="cap">老人赡养</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--purple)' }}>{data.special.minorRelated}</div><div className="cap">涉未成年人</div></div>
                <div className="stat-card"><div className="num">{data.special.disabled}</div><div className="cap">残障人士</div></div>
                <div className="stat-card"><div className="num">{data.special.opponentSued}</div><div className="cap">对方已起诉</div></div>
              </div>
            </div>

            <div className="card">
              <h2>期限风险与提醒及时性（服务质量复盘）</h2>
              <div className="stat-cards" style={{ marginBottom: 0 }}>
                <div className="stat-card"><div className="num" style={{ color: 'var(--red)' }}>{data.deadlineRisks?.EXPIRED ?? 0}</div><div className="cap">已逾期案件</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--red)' }}>{data.deadlineRisks?.HIGH ?? 0}</div><div className="cap">高风险案件</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--orange)' }}>{data.deadlineRisks?.MEDIUM ?? 0}</div><div className="cap">中风险案件</div></div>
                <div className="stat-card"><div className="num">{data.reminders?.total ?? 0}</div><div className="cap">期限提醒总数</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--green)' }}>{data.reminders?.timely ?? 0}</div><div className="cap">提醒及时</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--orange)' }}>{data.reminders?.late ?? 0}</div><div className="cap">临近才提醒</div></div>
                <div className="stat-card"><div className="num" style={{ color: 'var(--red)' }}>{data.reminders?.missed ?? 0}</div><div className="cap">逾期才提醒</div></div>
              </div>
            </div>

            <div className="grid-2">
              <BarChart title="案件类型分布" data={data.byType} labels={TYPE_LABELS} />
              <BarChart title="分流去向分布" data={data.byCategory} labels={CATEGORY_LABELS} />
              <BarChart title="来源渠道分布" data={data.bySource} labels={SOURCE_LABELS} />
              <BarChart title="案件状态分布" data={data.byStatus} labels={STATUS_LABELS} />
            </div>

            <div className="card">
              <h2>律师工作量与服务质量</h2>
              <table className="table">
                <thead><tr><th>律师</th><th>律所</th><th>承办案件</th><th>已结案</th><th>累计工时</th><th>平均满意度</th><th>状态</th></tr></thead>
                <tbody>
                  {lawyers.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="muted">{l.organization || '—'}</td>
                      <td>{l.assigned}</td>
                      <td>{l.closed}</td>
                      <td>{l.hours} 小时</td>
                      <td>{l.satisfactionAvg ? `${l.satisfactionAvg} 分` : '—'}</td>
                      <td>{l.onLeave ? <span className="badge badge-orange">请假中</span> : <span className="badge badge-green">在岗</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
