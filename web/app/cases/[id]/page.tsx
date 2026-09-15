'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Empty, ErrorBox, Loading, Nav, OkBox } from '../../components'
import {
  api, APPT_STATUS_LABELS, CATEGORY_LABELS, CHANNEL_LABELS, CONF_LABELS, confBadge, daysLeft, fmtDate, fmtDateTime,
  getUser, INTENT_LABELS, MATERIAL_STATUS_LABELS, materialStatusBadge, priorityBadge, PRIORITY_LABELS,
  REFERRAL_STATUS_LABELS, REFERRAL_TYPE_LABELS, RISK_LABELS, riskBadge, ROLE_LABELS, SessionUser, SOURCE_LABELS,
  specialFlags, statusBadge, STATUS_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS, taskStatusBadge,
  TIMELINESS_LABELS, timelinessBadge, TYPE_LABELS, URGENCY_LABELS, DV_SIGNAL_LABELS, DV_RISK_LEVEL_LABELS,
} from '../../lib'

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [kase, setKase] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [lawyers, setLawyers] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])

  const load = useCallback(async () => {
    try {
      setKase(await api(`/cases/${id}`))
    } catch (err: any) {
      setError(err.message)
    }
  }, [id])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    setUser(u)
  }, [router])

  useEffect(() => { if (user) load() }, [user, load])

  useEffect(() => {
    if (!user) return
    if (['STAFF', 'ADMIN', 'JUDICIAL'].includes(user.role)) {
      api('/users/lawyers').then(setLawyers).catch(() => {})
      api('/users').then(setAllUsers).catch(() => {})
    } else if (user.role === 'LAWYER') {
      api('/users/lawyers').then(setLawyers).catch(() => {})
    }
  }, [user])

  if (!user) return null

  async function run(fn: () => Promise<any>, okMsg = '操作成功') {
    setError(null); setOk(null)
    try {
      await fn()
      setOk(okMsg)
      await load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const role = user.role
  const isStaff = ['STAFF', 'ADMIN'].includes(role)
  const isJudicial = role === 'JUDICIAL'
  const isUnit = ['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'].includes(role)
  const isLawyer = role === 'LAWYER'
  const isOwner = kase?.residentId === user.id
  const isAssignedLawyer = isLawyer && kase?.lawyerId === user.id
  const canSeePool = isLawyer && kase && kase.category === 'LEGAL_AID' && !kase.lawyerId &&
    ['CLASSIFIED', 'AWAITING_LAWYER', 'MATERIAL_SUPPLEMENT'].includes(kase.status)

  const materials = kase?.materials || []
  const verifiedCount = materials.filter((m: any) => m.status === 'VERIFIED').length
  const completeness = materials.length ? Math.round((verifiedCount / materials.length) * 100) : 0
  const statuteDays = kase ? daysLeft(kase.statuteOfLimitations) : null
  const referralsSafetyCount = (kase?.referrals || []).filter((r: any) => r.isSafetyReferral).length

  // 任务状态变更权限：任务负责人 / 对应角色（角色任务）/ 管理员
  const canUpdateTask = (t: any) =>
    user.role === 'ADMIN' || t.assigneeId === user.id || (!t.assigneeId && t.assigneeRole === role)

  // 结案前置条件：完成规定服务阶段（法援案件须服务进行中；其他类型须已分流/转介）
  const closable = kase && kase.status !== 'CLOSED' && !['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status) &&
    (kase.category === 'LEGAL_AID' ? kase.status === 'IN_SERVICE' : ['CLASSIFIED', 'REFERRED'].includes(kase.status))

  return (
    <>
      <Nav />
      <div className="container">
        <ErrorBox error={error} />
        <OkBox text={ok} />
        {!kase ? <Loading /> : (
          <>
            {/* ---------- 头部 ---------- */}
            <div className="card">
              <div className="flex-between">
                <div>
                  <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>{kase.title}</h1>
                  <div className="row">
                    <span className="muted">{kase.caseNo}</span>
                    <Badge text={STATUS_LABELS[kase.status]} cls={statusBadge(kase.status)} />
                    <Badge text={`优先级：${PRIORITY_LABELS[kase.priority]}`} cls={priorityBadge(kase.priority)} />
                    <Badge text={`保密：${CONF_LABELS[kase.confidentiality]}`} cls={confBadge(kase.confidentiality)} />
                    {kase.category && <Badge text={`分流：${CATEGORY_LABELS[kase.category]}`} cls="badge-blue" />}
                    {specialFlags(kase).map((f) => <Badge key={f} text={f} cls="badge-red" />)}
                  </div>
                </div>
                <button className="btn" onClick={() => router.push('/cases')}>返回列表</button>
              </div>
              {statuteDays !== null && statuteDays <= 30 && kase.status !== 'CLOSED' && (
                <div className="alert alert-red mt8">⚠️ 诉讼时效临近：距离届满仅剩 <b>{Math.max(statuteDays, 0)}</b> 天（{fmtDate(kase.statuteOfLimitations)}），请优先处理！</div>
              )}
              {kase.riskInfo && ['MEDIUM', 'HIGH', 'EXPIRED'].includes(kase.riskInfo.level) && (
                <div className={`alert mt8 ${kase.riskInfo.level === 'MEDIUM' ? 'alert-orange' : 'alert-red'}`}>
                  ⏰ <b>期限风险：{RISK_LABELS[kase.riskInfo.level]}</b>
                  {kase.riskInfo.deadline && <>（关键期限 {fmtDate(kase.riskInfo.deadline)}{kase.riskInfo.daysLeft !== null && (kase.riskInfo.daysLeft < 0 ? `，已逾期 ${-kase.riskInfo.daysLeft} 天` : `，剩余 ${kase.riskInfo.daysLeft} 天`)}）</>}
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {kase.riskInfo.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {kase.opponentSued && kase.status !== 'CLOSED' && (
                <div className="alert alert-orange mt8">⚠️ 对方已经起诉，申请人需尽快应诉，请加快分流与指派。</div>
              )}
              {kase.lawyer?.onLeave && kase.status !== 'CLOSED' && (
                <div className="alert alert-orange mt8">⚠️ 承办律师 {kase.lawyer.name} 当前请假中，可能需要重新指派。</div>
              )}
              {kase.confidentiality !== 'NORMAL' && (
                <div className="alert alert-blue mt8">🔒 本案为{CONF_LABELS[kase.confidentiality]}案件：申请人身份信息仅对承办人员可见，请注意保密。</div>
              )}
              {kase.ruleNotes && <div className="alert alert-blue mt8">特殊规则：{kase.ruleNotes}</div>}
              {kase.isDomesticViolence && (
                <div className="alert alert-red mt8">
                  🛟 <b>家庭暴力风险案件</b>
                  {(kase.dvSignalThreat || kase.dvSignalHarm || kase.dvSignalControl) && (
                    <span>
                      ：系统在咨询描述中识别出
                      {[['dvSignalThreat', 'threat'], ['dvSignalHarm', 'harm'], ['dvSignalControl', 'control']]
                        .filter(([f]) => kase[f as string])
                        .map(([, k]) => DV_SIGNAL_LABELS[k as string])
                        .join('、')}
                      {kase.dvSignalNote ? `（${kase.dvSignalNote}）` : ''}
                    </span>
                  )}
                  。律师咨询不得孤立推进，须由社区记录安全信息并转介司法所/妇联/派出所协同。
                </div>
              )}
            </div>

            {/* ---------- 家暴风险安全处置 ---------- */}
            {kase.isDomesticViolence && (
              <SafetyManagement kase={kase} user={user} allUsers={allUsers} onRun={run} />
            )}

            <div className="grid-2">
              {/* ---------- 案件信息 ---------- */}
              <div className="card">
                <h2>案件信息</h2>
                <dl className="kv">
                  <dt>咨询类型</dt><dd>{TYPE_LABELS[kase.type]}</dd>
                  <dt>来源渠道</dt><dd>{SOURCE_LABELS[kase.source]}</dd>
                  <dt>申请人</dt><dd>{kase.applicantName}{kase.applicantPhone ? `（${kase.applicantPhone}）` : ''}</dd>
                  <dt>现住址</dt><dd>{kase.applicantAddress || '—'}</dd>
                  <dt>所属街道</dt><dd>{kase.street || '—'}</dd>
                  <dt>家庭月收入</dt><dd>{kase.familyIncome != null ? `${kase.familyIncome} 元` : '—'}</dd>
                  <dt>紧急程度</dt><dd>{URGENCY_LABELS[kase.urgency]}</dd>
                  <dt>冲突主体</dt><dd>{kase.opposingParties || '—'}</dd>
                  <dt>事件日期</dt><dd>{kase.incidentDate ? fmtDate(kase.incidentDate) : '—'}</dd>
                  <dt>诉讼时效</dt><dd>{kase.statuteOfLimitations ? `${fmtDate(kase.statuteOfLimitations)}${statuteDays !== null ? `（剩余 ${Math.max(statuteDays, 0)} 天）` : ''}` : '—'}</dd>
                  <dt>推算关键期限</dt><dd>{kase.estimatedDeadline ? fmtDate(kase.estimatedDeadline) : '—'}</dd>
                  <dt>居民意愿</dt><dd>{kase.residentIntent ? INTENT_LABELS[kase.residentIntent] : '未登记'}{kase.residentIntentNote ? `（${kase.residentIntentNote}）` : ''}</dd>
                  <dt>其他期限</dt><dd>{kase.deadlineNotes || '—'}</dd>
                  <dt>承办律师</dt><dd>{kase.lawyer ? `${kase.lawyer.name}（${kase.lawyer.organization || '—'}）` : '未指派'}</dd>
                  <dt>提交时间</dt><dd>{fmtDateTime(kase.createdAt)}</dd>
                </dl>
                <h3>诉求与案件事实</h3>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{kase.description}</p>
                {kase.keyDates?.length > 0 && (
                  <>
                    <h3>关键时间节点</h3>
                    <table className="table">
                      <tbody>
                        {kase.keyDates.map((k: any) => (
                          <tr key={k.id}><td>{k.label}</td><td>{fmtDate(k.date)}</td><td className="muted">{daysLeft(k.date) !== null ? `剩余 ${Math.max(daysLeft(k.date)!, 0)} 天` : ''}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                {kase.reviewNotes && (
                  <>
                    <h3>初审意见</h3>
                    <p className="muted" style={{ margin: 0 }}>
                      {kase.reviewedBy?.name}：{kase.reviewNotes}
                      {kase.incomeQualified !== null && `（经济困难资格：${kase.incomeQualified ? '通过' : '不通过'}）`}
                    </p>
                  </>
                )}
              </div>

              {/* ---------- 证据材料 ---------- */}
              <div className="card">
                <h2>证据材料（完整度 {completeness}%）</h2>
                <div className="row">
                  <span className="progress"><span style={{ display: 'block', width: `${completeness}%`, height: '100%', background: 'var(--green)' }} /></span>
                  <span className="muted">已核验 {verifiedCount}/{materials.length}</span>
                </div>
                {materials.length === 0 ? <Empty text="暂无材料" /> : (
                  <table className="table mt8">
                    <thead><tr><th>材料</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {materials.map((m: any) => (
                        <tr key={m.id}>
                          <td>
                            <div>{m.name}{m.kind ? <span className="muted">（{m.kind}）</span> : null}</div>
                            {m.note && <div className="muted" style={{ fontSize: 12 }}>{m.note}</div>}
                            <div className="muted" style={{ fontSize: 12 }}>
                              {m.uploadedBy ? `${m.uploadedBy.name} · ` : ''}{fmtDate(m.createdAt)}
                              {m.filePath && <> · <a href={`/api/materials/${m.id}/file?token=`} onClick={(e) => { e.preventDefault(); downloadFile(m.id) }}>下载附件</a></>}
                            </div>
                          </td>
                          <td><Badge text={MATERIAL_STATUS_LABELS[m.status]} cls={materialStatusBadge(m.status)} /></td>
                          <td>
                            {(isStaff || isAssignedLawyer) && m.status !== 'VERIFIED' && m.status !== 'MISSING' && (
                              <div className="btn-row" style={{ marginTop: 0 }}>
                                <button className="btn btn-sm" onClick={() => run(() => api(`/materials/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'VERIFIED' }) }), '材料已核验')}>核验通过</button>
                                <button className="btn btn-sm" onClick={() => {
                                  const note = prompt('补正说明（告知居民需要补什么）', m.note || '')
                                  if (note !== null) run(() => api(`/materials/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'NEEDS_CORRECTION', note }) }), '已标记需补正')
                                }}>要求补正</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {(isOwner || isStaff || isAssignedLawyer || role === 'VOLUNTEER') && kase.status !== 'CLOSED' && (
                  <UploadMaterial caseId={kase.id} onDone={() => run(async () => {}, '材料已上传')} reload={load} setError={setError} setOk={setOk} />
                )}
                {(isStaff || isAssignedLawyer) && kase.status !== 'CLOSED' && (
                  <RequestMaterial onSubmit={(dto) => run(() => api(`/cases/${kase.id}/material-requests`, { method: 'POST', body: JSON.stringify(dto) }), '已登记待补材料并通知申请人')} />
                )}
              </div>
            </div>

            {/* ---------- 服务单 ---------- */}
            <div className="card">
              <h2>服务单 {kase.serviceOrder ? `（${kase.serviceOrder.orderNo}）` : '（初审分流后生成）'}</h2>
              {kase.serviceOrder && (
                <>
                  <div>
                    {(kase.serviceOrder.participants || []).map((p: any) => (
                      <span key={p.id} className="chip">
                        {p.user.name} <span className="duty">{ROLE_LABELS[p.user.role]}{p.duty ? ` · ${p.duty}` : ''}</span>
                      </span>
                    ))}
                  </div>
                  {(isStaff || isJudicial) && kase.status !== 'CLOSED' && (
                    <AddParticipant users={allUsers} existing={(kase.serviceOrder.participants || []).map((p: any) => p.userId)}
                      onSubmit={(dto) => run(() => api(`/cases/${kase.id}/participants`, { method: 'POST', body: JSON.stringify(dto) }), '已加入服务单')} />
                  )}
                </>
              )}

              <h3>协同任务</h3>
              {kase.tasks?.length === 0 ? <Empty text="暂无任务" /> : (
                <table className="table">
                  <thead><tr><th>任务</th><th>类型</th><th>负责人</th><th>截止</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {kase.tasks.map((t: any) => (
                      <tr key={t.id}>
                        <td>
                          <div>{t.title}</div>
                          {t.description && <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>}
                        </td>
                        <td>{TASK_TYPE_LABELS[t.type]}</td>
                        <td>{t.assignee ? t.assignee.name : (t.assigneeRole ? `${ROLE_LABELS[t.assigneeRole]}（待定）` : '—')}</td>
                        <td className="muted">{fmtDate(t.dueDate)}</td>
                        <td>
                          <Badge text={TASK_STATUS_LABELS[t.status]} cls={taskStatusBadge(t.status)} />
                          {t.status === 'DONE' && t.completedBy && (
                            <div className="muted" style={{ fontSize: 12 }}>完成人：{t.completedBy.name}</div>
                          )}
                        </td>
                        <td>
                          {['OPEN', 'IN_PROGRESS'].includes(t.status) && canUpdateTask(t) && (
                            <div className="btn-row" style={{ marginTop: 0 }}>
                              {t.status === 'OPEN' && <button className="btn btn-sm" onClick={() => run(() => api(`/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'IN_PROGRESS' }) }), '已开始办理')}>开始</button>}
                              <button className="btn btn-sm" onClick={() => run(() => api(`/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) }), '任务已完成')}>完成</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {['STAFF', 'ADMIN', 'LAWYER', 'JUDICIAL', 'VOLUNTEER'].includes(role) && kase.status !== 'CLOSED' && (
                <AddTask users={allUsers} onSubmit={(dto) => run(() => api(`/cases/${kase.id}/tasks`, { method: 'POST', body: JSON.stringify(dto) }), '任务已创建')} />
              )}
            </div>

            {/* ---------- 角色操作区 ---------- */}
            {isStaff && ['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status) && (
              <ReviewPanel onSubmit={(dto) => run(() => api(`/cases/${kase.id}/review`, { method: 'POST', body: JSON.stringify(dto) }), '初审分流完成')} />
            )}

            {isStaff && kase.category === 'LEGAL_AID' && !kase.lawyerId && kase.status !== 'CLOSED' && (
              <AssignPanel lawyers={lawyers} onSubmit={(lawyerId) => run(() => api(`/cases/${kase.id}/assign`, { method: 'POST', body: JSON.stringify({ lawyerId }) }), '已指派律师')} />
            )}

            {isLawyer && kase.status !== 'CLOSED' && (canSeePool || isAssignedLawyer) && (
              <LawyerPanel
                kase={kase}
                userId={user.id}
                isAssigned={isAssignedLawyer}
                canSeePool={canSeePool}
                onTake={() => run(() => api(`/cases/${kase.id}/take`, { method: 'POST' }), '已领取案件，请完成利益冲突核查')}
                onConflict={(dto) => run(() => api(`/cases/${kase.id}/conflict-check`, { method: 'POST', body: JSON.stringify(dto) }), dto.hasConflict ? '已登记利益冲突并回避' : '冲突核查完成')}
                onAccept={() => run(() => api(`/cases/${kase.id}/accept`, { method: 'POST' }), '已接受案件')}
                onDecline={(reason) => run(() => api(`/cases/${kase.id}/decline`, { method: 'POST', body: JSON.stringify({ reason }) }), '已退回案件')}
              />
            )}

            {/* ---------- 期限管理（工作人员） ---------- */}
            {kase.status !== 'CLOSED' && (isStaff || (kase.reminders || []).length > 0) && (
              <div className="card">
                <h2>期限管理</h2>
                {isStaff && (
                  <DeadlinePanel
                    kase={kase}
                    onChecklist={() => run(() => api(`/cases/${kase.id}/material-checklist`, { method: 'POST' }), '已生成标准材料清单并通知居民')}
                    onIntent={(dto) => run(() => api(`/cases/${kase.id}/resident-intent`, { method: 'POST', body: JSON.stringify(dto) }), '居民意愿已登记')}
                    onRemind={(dto) => run(() => api(`/cases/${kase.id}/deadline-reminders`, { method: 'POST', body: JSON.stringify(dto) }), '期限提醒已登记')}
                  />
                )}
                {(kase.reminders || []).length > 0 && (
                  <>
                    <h3>提醒记录</h3>
                    <table className="table">
                      <thead><tr><th>时间</th><th>方式</th><th>说明</th><th>距期限</th><th>及时性</th><th>提醒人</th></tr></thead>
                      <tbody>
                        {kase.reminders.map((r: any) => (
                          <tr key={r.id}>
                            <td className="muted">{fmtDateTime(r.createdAt)}</td>
                            <td>{CHANNEL_LABELS[r.channel] || r.channel}</td>
                            <td>{r.note || '—'}</td>
                            <td>{r.daysLeftAtReminder === null ? '—' : r.daysLeftAtReminder < 0 ? `已逾期 ${-r.daysLeftAtReminder} 天` : `${r.daysLeftAtReminder} 天`}</td>
                            <td><Badge text={TIMELINESS_LABELS[r.timeliness]} cls={timelinessBadge(r.timeliness)} /></td>
                            <td className="muted">{r.remindedBy?.name || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}

            {/* ---------- 预约 ---------- */}
            <div className="card">
              <h2>咨询预约</h2>
              {kase.appointments?.length === 0 ? <Empty text="暂无预约" /> : (
                <table className="table">
                  <thead><tr><th>时间</th><th>地点/方式</th><th>律师</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {kase.appointments.map((a: any) => (
                      <tr key={a.id}>
                        <td>{fmtDateTime(a.scheduledAt)}</td>
                        <td>{a.location || '—'}{a.note ? <div className="muted" style={{ fontSize: 12 }}>{a.note}</div> : null}</td>
                        <td>{a.lawyer?.name || '待定'}</td>
                        <td><Badge text={APPT_STATUS_LABELS[a.status]} cls="badge-blue" /></td>
                        <td>
                          {(isStaff || isAssignedLawyer) && ['PENDING', 'CONFIRMED'].includes(a.status) && (
                            <div className="btn-row" style={{ marginTop: 0 }}>
                              {a.status === 'PENDING' && <button className="btn btn-sm" onClick={() => run(() => api(`/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CONFIRMED' }) }), '预约已确认')}>确认</button>}
                              <button className="btn btn-sm" onClick={() => run(() => api(`/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }), '预约已完成')}>完成</button>
                              <button className="btn btn-sm" onClick={() => run(() => api(`/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }) }), '预约已取消')}>取消</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(isStaff || isAssignedLawyer) && kase.status !== 'CLOSED' && (
                <AddAppointment onSubmit={(dto) => run(() => api(`/cases/${kase.id}/appointments`, { method: 'POST', body: JSON.stringify(dto) }), '预约已创建')} />
              )}
            </div>

            {/* ---------- 转介 ---------- */}
            <div className="card">
              <h2>转介记录{referralsSafetyCount > 0 && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>（含 {referralsSafetyCount} 条家暴协同转介，授权人员可见联系方式与住址）</span>}</h2>
              {kase.referrals?.length === 0 ? <Empty text="暂无转介" /> : (
                <table className="table">
                  <thead><tr><th>类型</th><th>去向</th><th>原因</th><th>接收/授权</th><th>回访</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    {kase.referrals.map((r: any) => (
                      <tr key={r.id}>
                        <td>
                          {REFERRAL_TYPE_LABELS[r.type] || r.type}
                          {r.isSafetyReferral && <div><Badge text="家暴协同" cls="badge-red" /></div>}
                        </td>
                        <td>{r.toUnit}{r.toStreet ? `（${r.toStreet}）` : ''}</td>
                        <td className="muted">{r.reason || '—'}</td>
                        <td style={{ fontSize: 12 }}>
                          {r.acceptedBy
                            ? <span>接收人：{r.acceptedBy.name}</span>
                            : <span className="muted">待接收</span>}
                          {(r.grants || []).length > 0 && (
                            <div className="muted">授权：{r.grants.filter((g: any) => !g.revokedAt).map((g: any) => g.user.name).join('、') || '—'}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {(r.followUps || []).length === 0 ? <span className="muted">—</span> : r.followUps.map((f: any, i: number) => (
                            <div key={f.id}>
                              {f.doneAt ? '✓' : '计划'} {fmtDate(f.scheduledAt)}
                              {f.result ? `：${f.result}` : ''}
                            </div>
                          ))}
                        </td>
                        <td><Badge text={REFERRAL_STATUS_LABELS[r.status]} cls="badge-purple" /></td>
                        <td>
                          {(isStaff || isUnit) && r.status === 'PENDING' && (
                            <div className="btn-row" style={{ marginTop: 0 }}>
                              <button className="btn btn-sm" onClick={() => run(() => api(`/referrals/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACCEPTED' }) }), '已接收，您已获授权查看联系方式与住址')}>接收</button>
                              <button className="btn btn-sm" onClick={() => run(() => api(`/referrals/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'REJECTED' }) }), '已退回转介')}>退回</button>
                            </div>
                          )}
                          {(isStaff || isUnit) && r.status === 'ACCEPTED' && (
                            <div className="btn-row" style={{ marginTop: 0 }}>
                              <button className="btn btn-sm" onClick={() => {
                                const d = prompt('安排回访日期（YYYY-MM-DD），默认 7 天后', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
                                if (d) run(() => api(`/referrals/${r.id}/follow-ups`, { method: 'POST', body: JSON.stringify({ scheduledAt: new Date(d + 'T10:00').toISOString() }) }), '回访已安排')
                              }}>安排回访</button>
                              {isStaff && <button className="btn btn-sm" onClick={() => run(() => api(`/referrals/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }) }), '转介已办结')}>办结</button>}
                            </div>
                          )}
                          {(isStaff || isUnit) && r.status === 'ACCEPTED' && (r.followUps || []).some((f: any) => !f.doneAt) && (
                            <button className="btn btn-sm" onClick={() => {
                              const pending = r.followUps.find((f: any) => !f.doneAt)
                              const result = prompt('登记回访结果')
                              if (result) run(() => api(`/referral-follow-ups/${pending.id}`, { method: 'PATCH', body: JSON.stringify({ result }) }), '回访结果已登记')
                            }}>登记回访结果</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {isStaff && kase.status !== 'CLOSED' && (
                <AddReferral onSubmit={(dto) => run(() => api(`/cases/${kase.id}/referrals`, { method: 'POST', body: JSON.stringify(dto) }), '转介已发起')} />
              )}
            </div>

            {/* ---------- 结案归档 / 档案 ---------- */}
            {closable && (isStaff || isAssignedLawyer) && (
              <ClosePanel onSubmit={(dto) => run(() => api(`/cases/${kase.id}/close`, { method: 'POST', body: JSON.stringify(dto) }), '已结案归档')} />
            )}
            {!closable && kase.status !== 'CLOSED' && (isStaff || isAssignedLawyer) && !['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status) && (
              <div className="card">
                <h2>结案归档</h2>
                <div className="alert alert-orange" style={{ margin: 0 }}>
                  暂不可结案：{kase.category === 'LEGAL_AID'
                    ? '法律援助案件须由承办律师接案、处于「服务进行中」状态后方可结案。'
                    : '需先完成分流/转介等服务阶段后方可结案。'}
                </div>
              </div>
            )}

            {kase.archive && (
              <div className="card">
                <h2>结案档案</h2>
                <dl className="kv">
                  <dt>咨询意见</dt><dd>{kase.archive.consultationOpinion || '—'}</dd>
                  <dt>材料补正记录</dt><dd>{kase.archive.materialCorrections || '—'}</dd>
                  <dt>转介去向</dt><dd>{kase.archive.referralDestination || '—'}</dd>
                  <dt>律师工时</dt><dd>{kase.archive.lawyerHours != null ? `${kase.archive.lawyerHours} 小时` : '—'}</dd>
                  <dt>回访结果</dt><dd>{kase.archive.followUpResult || '—'}</dd>
                  <dt>居民满意度</dt><dd>{kase.archive.satisfaction ? '★'.repeat(kase.archive.satisfaction) + `（${kase.archive.satisfaction} 分）${kase.archive.satisfactionNote ? '：' + kase.archive.satisfactionNote : ''}` : '未评价'}</dd>
                </dl>
                {isOwner && !kase.archive.satisfaction && (
                  <SatisfactionPanel onSubmit={(dto) => run(() => api(`/cases/${kase.id}/satisfaction`, { method: 'POST', body: JSON.stringify(dto) }), '感谢您的评价')} />
                )}
                {(isStaff || isJudicial) && (
                  <FollowUpPanel onSubmit={(dto) => run(() => api(`/cases/${kase.id}/follow-up`, { method: 'POST', body: JSON.stringify(dto) }), '回访结果已登记')} />
                )}
              </div>
            )}

            {/* ---------- 时间线 ---------- */}
            <div className="card">
              <h2>办理时间线</h2>
              <ul className="timeline">
                {(kase.events || []).map((e: any) => (
                  <li key={e.id}>
                    <div>{e.action}{e.detail ? `：${e.detail}` : ''}</div>
                    <div className="t-meta">{e.actor ? `${e.actor.name}（${ROLE_LABELS[e.actor.role]}）· ` : '系统 · '}{fmtDateTime(e.createdAt)}</div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ---------- 附件下载（带鉴权） ----------
async function downloadFile(materialId: string) {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/materials/${materialId}/file`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { alert('下载失败'); return }
  const blob = await res.blob()
  const dispo = res.headers.get('Content-Disposition') || ''
  const m = dispo.match(/filename="?([^";]+)"?/)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = m ? decodeURIComponent(m[1]) : '材料附件'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------- 子组件 ----------

function UploadMaterial({ caseId, reload, setError, setOk }: any) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name) { setError('请填写材料名称'); return }
    setBusy(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('name', name)
      if (kind) fd.append('kind', kind)
      if (file) fd.append('file', file)
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/cases/${caseId}/materials`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.message || '上传失败')
      }
      setOk('材料已上传')
      setName(''); setKind(''); setFile(null)
      await reload()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="mt16" style={{ borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
      <h3>上传材料</h3>
      <div className="row">
        <input className="input" style={{ width: 200 }} placeholder="材料名称 *" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" style={{ width: 130 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">类型</option>
          {['合同', '票据', '照片', '聊天记录', '证件', '鉴定', '其他'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input className="input" style={{ width: 240 }} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? '上传中…' : '上传'}</button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>支持图片、PDF、文档等，单个不超过 10MB；线下纸质材料可只登记名称。</p>
    </form>
  )
}

function RequestMaterial({ onSubmit }: any) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  return (
    <form className="mt16" style={{ borderTop: '1px dashed var(--border)', paddingTop: 12 }}
      onSubmit={(e) => { e.preventDefault(); if (name) { onSubmit({ name, note }); setName(''); setNote('') } }}>
      <h3>要求居民补交材料</h3>
      <div className="row">
        <input className="input" style={{ width: 200 }} placeholder="材料名称 *" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" style={{ width: 260 }} placeholder="补正说明" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm">登记待补</button>
      </div>
    </form>
  )
}

function ReviewPanel({ onSubmit }: any) {
  const [category, setCategory] = useState('LEGAL_AID')
  const [incomeQualified, setIncomeQualified] = useState(true)
  const [reviewNotes, setReviewNotes] = useState('')
  const [referralTo, setReferralTo] = useState('')
  return (
    <div className="card" style={{ borderColor: 'var(--primary)' }}>
      <h2>资格初审与分流（社区工作人员）</h2>
      <div className="form-grid">
        <div>
          <label className="label">分流去向 *</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">经济困难资格初审</label>
          <select className="input" value={incomeQualified ? '1' : '0'} onChange={(e) => setIncomeQualified(e.target.value === '1')}>
            <option value="1">通过（符合法律援助经济条件）</option>
            <option value="0">不通过</option>
          </select>
        </div>
      </div>
      {category === 'JUDICIAL_REFERRAL' && (
        <>
          <label className="label">转介单位</label>
          <input className="input" value={referralTo} onChange={(e) => setReferralTo(e.target.value)} placeholder="如：朝阳街道司法所" />
        </>
      )}
      <label className="label">初审意见</label>
      <textarea className="input" value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="资格判断、分流理由、注意事项" />
      <div className="btn-row">
        <button className="btn btn-primary" onClick={() => onSubmit({ category, incomeQualified, reviewNotes, referralTo: referralTo || undefined })}>提交初审分流</button>
      </div>
    </div>
  )
}

function AssignPanel({ lawyers, onSubmit }: any) {
  const [lawyerId, setLawyerId] = useState('')
  return (
    <div className="card">
      <h2>指派值班律师</h2>
      <div className="row">
        <select className="input" style={{ width: 320 }} value={lawyerId} onChange={(e) => setLawyerId(e.target.value)}>
          <option value="">选择律师…</option>
          {lawyers.map((l: any) => (
            <option key={l.id} value={l.id}>
              {l.name}（{l.organization || '—'}）{l.onLeave ? '【请假中】' : ''} 在办{l.activeCases}件
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!lawyerId} onClick={() => onSubmit(lawyerId)}>指派</button>
      </div>
      {lawyers.some((l: any) => l.onLeave) && <p className="muted" style={{ fontSize: 12 }}>提示：标注【请假中】的律师临时请假，请优先指派其他律师。</p>}
    </div>
  )
}

function LawyerPanel({ kase, userId, isAssigned, canSeePool, onTake, onConflict, onAccept, onDecline }: any) {
  const [hasConflict, setHasConflict] = useState(false)
  const [note, setNote] = useState('')
  const hasChecked = (kase.conflictChecks || []).some((c: any) => c.lawyer?.id === userId)
  return (
    <div className="card" style={{ borderColor: 'var(--purple)' }}>
      <h2>律师接案（接案前请核对：案件事实、关键期限、证据完整度、冲突主体、利益冲突）</h2>
      {kase.isDomesticViolence && kase.dvCoordination && !kase.dvCoordination.lawyerCanProceed && (
        <div className="alert alert-red">
          🛟 <b>家暴协同尚未就绪，律师不能孤立推进：</b>
          {!kase.dvCoordination.safetyPlanRecorded && '社区工作人员尚未记录安全联系人/临时住所/报警情况；'}
          {kase.dvCoordination.acceptedCount === 0 && '司法所/妇联/派出所尚无一单位接收协同转介；'}
          待社区完成安全处置并有协同单位接收后，本所方可接案。
          {kase.dvCoordination.units.length > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>
              协同进展：{kase.dvCoordination.units.map((u: any) => `${REFERRAL_TYPE_LABELS[u.type]}（${REFERRAL_STATUS_LABELS[u.status]}）`).join('、')}
            </div>
          )}
        </div>
      )}
      {kase.isDomesticViolence && kase.dvCoordination?.lawyerCanProceed && (
        <div className="alert alert-green">
          ✓ 家暴协同已建立（安全信息已记录，{kase.dvCoordination.acceptedCount} 个协同单位已接收），可在协同框架内接案推进，不再孤立办理。
        </div>
      )}
      {canSeePool && (
        <div className="btn-row">
          <button className="btn btn-primary" onClick={onTake}>领取本案</button>
        </div>
      )}
      {isAssigned && (
        <>
          <div className="form-grid">
            <div>
              <label className="label">利益冲突核查结论 *</label>
              <select className="input" value={hasConflict ? '1' : '0'} onChange={(e) => setHasConflict(e.target.value === '1')}>
                <option value="0">无利益冲突</option>
                <option value="1">存在利益冲突（回避）</option>
              </select>
            </div>
            <div>
              <label className="label">核查说明</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={`已核对冲突主体：${kase.opposingParties || '—'}`} />
            </div>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => onConflict({ hasConflict, note })}>提交冲突核查</button>
            {kase.status === 'AWAITING_LAWYER' && (
              <button
                className="btn btn-primary"
                disabled={kase.isDomesticViolence && kase.dvCoordination && !kase.dvCoordination.lawyerCanProceed}
                title={kase.isDomesticViolence && kase.dvCoordination && !kase.dvCoordination.lawyerCanProceed ? '需先完成社区安全处置并由协同单位接收' : ''}
                onClick={onAccept}
              >接受案件</button>
            )}
            <button className="btn btn-danger" onClick={() => {
              const reason = prompt('退案原因')
              if (reason !== null) onDecline(reason)
            }}>退回案件</button>
          </div>
          {kase.status === 'AWAITING_LAWYER' && !hasChecked && (
            <p className="muted" style={{ fontSize: 12 }}>提示：需先提交利益冲突核查，才能接受案件。</p>
          )}
        </>
      )}
    </div>
  )
}

function AddParticipant({ users, existing, onSubmit }: any) {
  const [userId, setUserId] = useState('')
  const [duty, setDuty] = useState('')
  const candidates = users.filter((u: any) => !existing.includes(u.id))
  return (
    <div className="row mt8">
      <select className="input" style={{ width: 260 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">添加协同人员…</option>
        {candidates.map((u: any) => <option key={u.id} value={u.id}>{u.name}（{ROLE_LABELS[u.role]} · {u.organization || '—'}）</option>)}
      </select>
      <input className="input" style={{ width: 180 }} placeholder="分工说明" value={duty} onChange={(e) => setDuty(e.target.value)} />
      <button className="btn btn-sm" disabled={!userId} onClick={() => { onSubmit({ userId, duty }); setUserId(''); setDuty('') }}>加入服务单</button>
    </div>
  )
}

function AddTask({ users, onSubmit }: any) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('OTHER')
  const [assigneeRole, setAssigneeRole] = useState('')
  const [dueDate, setDueDate] = useState('')
  return (
    <form className="mt8" onSubmit={(e) => {
      e.preventDefault()
      if (!title) return
      onSubmit({ title, type, assigneeRole: assigneeRole || undefined, dueDate: dueDate || undefined })
      setTitle('')
    }}>
      <div className="row">
        <input className="input" style={{ width: 280 }} placeholder="新任务标题 *" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TASK_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" style={{ width: 140 }} value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)}>
          <option value="">负责角色</option>
          {['RESIDENT', 'STAFF', 'LAWYER', 'JUDICIAL', 'VOLUNTEER'].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <input className="input" style={{ width: 160 }} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button className="btn btn-sm">添加任务</button>
      </div>
    </form>
  )
}

function AddAppointment({ onSubmit }: any) {
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')
  const [note, setNote] = useState('')
  return (
    <form className="mt8" onSubmit={(e) => {
      e.preventDefault()
      if (!scheduledAt) return
      onSubmit({ scheduledAt: new Date(scheduledAt).toISOString(), location, note })
      setScheduledAt(''); setLocation(''); setNote('')
    }}>
      <div className="row">
        <input className="input" style={{ width: 210 }} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        <input className="input" style={{ width: 220 }} placeholder="地点/方式，如：社区调解室" value={location} onChange={(e) => setLocation(e.target.value)} />
        <input className="input" style={{ width: 220 }} placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm">新增预约</button>
      </div>
    </form>
  )
}

function AddReferral({ onSubmit }: any) {
  const [type, setType] = useState('JUDICIAL')
  const [toUnit, setToUnit] = useState('')
  const [toStreet, setToStreet] = useState('')
  const [reason, setReason] = useState('')
  return (
    <form className="mt8" onSubmit={(e) => {
      e.preventDefault()
      if (!toUnit) return
      onSubmit({ type, toUnit, toStreet: toStreet || undefined, reason })
      setToUnit(''); setToStreet(''); setReason('')
    }}>
      <div className="row">
        <select className="input" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(REFERRAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" style={{ width: 220 }} placeholder="接收单位 *" value={toUnit} onChange={(e) => setToUnit(e.target.value)} />
        {type === 'CROSS_STREET' && (
          <input className="input" style={{ width: 150 }} placeholder="目标街道" value={toStreet} onChange={(e) => setToStreet(e.target.value)} />
        )}
        <input className="input" style={{ width: 240 }} placeholder="转介原因" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-sm">发起转介</button>
      </div>
    </form>
  )
}

function ClosePanel({ onSubmit }: any) {
  const [form, setForm] = useState({ consultationOpinion: '', materialCorrections: '', referralDestination: '', lawyerHours: '', followUpResult: '' })
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))
  // 归档必填：咨询意见、材料补正记录、转介去向、律师工时
  const complete =
    form.consultationOpinion.trim() !== '' &&
    form.materialCorrections.trim() !== '' &&
    form.referralDestination.trim() !== '' &&
    form.lawyerHours.trim() !== '' && !isNaN(Number(form.lawyerHours)) && Number(form.lawyerHours) >= 0
  return (
    <div className="card" style={{ borderColor: 'var(--green)' }}>
      <h2>结案归档</h2>
      <div className="alert alert-blue" style={{ marginTop: 0 }}>
        归档必填：咨询意见、材料补正记录、转介去向、律师工时。资料不全将无法结案。
      </div>
      <label className="label">咨询意见 *</label>
      <textarea className="input" value={form.consultationOpinion} onChange={(e) => set('consultationOpinion', e.target.value)} />
      <div className="form-grid">
        <div>
          <label className="label">材料补正记录 *（无补正填"无"）</label>
          <input className="input" value={form.materialCorrections} onChange={(e) => set('materialCorrections', e.target.value)} />
        </div>
        <div>
          <label className="label">转介去向 *（无转介填"无"）</label>
          <input className="input" value={form.referralDestination} onChange={(e) => set('referralDestination', e.target.value)} />
        </div>
        <div>
          <label className="label">律师工时（小时）*</label>
          <input className="input" type="number" step="0.5" min="0" value={form.lawyerHours} onChange={(e) => set('lawyerHours', e.target.value)} />
        </div>
        <div>
          <label className="label">回访结果（可结案后补登）</label>
          <input className="input" value={form.followUpResult} onChange={(e) => set('followUpResult', e.target.value)} />
        </div>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={!complete}
          onClick={() => onSubmit({ ...form, lawyerHours: Number(form.lawyerHours) })}>
          结案并归档
        </button>
      </div>
    </div>
  )
}

function SatisfactionPanel({ onSubmit }: any) {
  const [score, setScore] = useState(5)
  const [note, setNote] = useState('')
  return (
    <div className="mt16" style={{ borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
      <h3>服务评价（居民）</h3>
      <div className="row">
        <select className="input" style={{ width: 160 }} value={score} onChange={(e) => setScore(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{'★'.repeat(s)}（{s} 分）</option>)}
        </select>
        <input className="input" style={{ width: 320 }} placeholder="评价说明（可选）" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => onSubmit({ score, note })}>提交评价</button>
      </div>
    </div>
  )
}

function FollowUpPanel({ onSubmit }: any) {
  const [result, setResult] = useState('')
  return (
    <div className="mt16" style={{ borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
      <h3>回访登记（工作人员）</h3>
      <div className="row">
        <input className="input" style={{ width: 420 }} placeholder="回访结果，如：已按咨询意见办理，问题已解决" value={result} onChange={(e) => setResult(e.target.value)} />
        <button className="btn btn-sm" disabled={!result} onClick={() => { onSubmit({ result }); setResult('') }}>登记回访</button>
      </div>
    </div>
  )
}

// ---------- 期限管理面板（工作人员） ----------
function DeadlinePanel({ kase, onChecklist, onIntent, onRemind }: any) {
  const [intent, setIntent] = useState('WILLING')
  const [intentNote, setIntentNote] = useState('')
  const [channel, setChannel] = useState('PHONE')
  const [remindNote, setRemindNote] = useState('')
  return (
    <div>
      <div className="row">
        <button className="btn" onClick={onChecklist}>📋 生成标准材料清单</button>
        <span className="muted" style={{ fontSize: 12 }}>按案件类型生成待补材料清单并通知居民准备</span>
      </div>
      <div className="grid-2 mt16">
        <div>
          <h3>居民意愿登记</h3>
          <div className="row">
            <select className="input" style={{ width: 190 }} value={intent} onChange={(e) => setIntent(e.target.value)}>
              {Object.entries(INTENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="备注（如：居民要求本周内安排律师）" value={intentNote} onChange={(e) => setIntentNote(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={() => { onIntent({ intent, note: intentNote }); setIntentNote('') }}>登记</button>
          </div>
          {kase.residentIntent && <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>当前意愿：{INTENT_LABELS[kase.residentIntent]}{kase.residentIntentNote ? `（${kase.residentIntentNote}）` : ''}</p>}
        </div>
        <div>
          <h3>期限提醒登记</h3>
          <div className="row">
            <select className="input" style={{ width: 130 }} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="提醒内容（如：已电话告知仲裁时效仅剩20天）" value={remindNote} onChange={(e) => setRemindNote(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={() => { onRemind({ channel, note: remindNote }); setRemindNote('') }}>登记提醒</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>系统按提醒时距期限天数自动评估及时性（及时/临近/逾期），用于服务质量复盘。</p>
        </div>
      </div>
    </div>
  )
}

// ---------- 家暴风险安全处置（安全信息 / 协同转介 / 授权 / 回访） ----------
const SAFETY_UNITS = [
  { type: 'JUDICIAL', label: '司法所' },
  { type: 'WOMEN_FEDERATION', label: '妇联' },
  { type: 'POLICE', label: '派出所' },
]

function SafetyManagement({ kase, user, allUsers, onRun }: any) {
  const isStaff = ['STAFF', 'ADMIN'].includes(user.role)
  const isUnit = ['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'].includes(user.role)
  const sp = kase.safetyPlan
  const coord = kase.dvCoordination
  const safetyRefs = (kase.referrals || []).filter((r: any) => r.isSafetyReferral)

  return (
    <div className="card" style={{ borderColor: 'var(--red)', borderWidth: 2 }}>
      <h2 style={{ borderLeftColor: 'var(--red)' }}>🛟 家暴风险安全处置（律师咨询不孤立推进）</h2>

      {/* 协同状态总览 */}
      <div className="row">
        <Badge text={sp ? '安全信息已记录' : '安全信息待记录'} cls={sp ? 'badge-green' : 'badge-red'} />
        <Badge text={`已转介 ${coord?.referralCount || 0} 个协同单位`} cls={(coord?.referralCount || 0) > 0 ? 'badge-blue' : 'badge-gray'} />
        <Badge text={`${coord?.acceptedCount || 0} 个单位已接收`} cls={(coord?.acceptedCount || 0) > 0 ? 'badge-green' : 'badge-orange'} />
        <Badge text={coord?.lawyerCanProceed ? '律师可在协同框架内推进' : '律师暂不可接案推进'} cls={coord?.lawyerCanProceed ? 'badge-green' : 'badge-red'} />
      </div>
      <div className="alert alert-blue">
        当事人联系方式与现住址严格保密：仅工作人员、承办律师及各协同单位的<b>授权人员</b>（接收人或被单独授权者）可查看；其他人员看到的均为脱敏信息。
      </div>

      {/* 社区工作人员：记录安全联系人 / 临时住所 / 报警情况 */}
      {isStaff && kase.status !== 'CLOSED' && (
        <SafetyPlanForm key={sp ? sp.id : 'new'} kase={kase} onRun={onRun} />
      )}

      {/* 已记录的安全信息（只读；非授权人员后端已脱敏/裁剪） */}
      {sp && (
        <div className="mt8">
          <h3>已记录的安全信息</h3>
          <dl className="kv">
            <dt>安全联系人</dt>
            <dd>{sp.emergencyContactName || '—'}{sp.emergencyContactPhone ? `（${sp.emergencyContactPhone}）` : ''}{sp.emergencyContactRel ? ` · 关系：${sp.emergencyContactRel}` : ''}</dd>
            <dt>临时住所</dt>
            <dd>{sp.shelterArranged ? `${sp.shelterName || '已安排'} ${sp.shelterAddress || ''}` : '暂未安排'}</dd>
            <dt>报警情况</dt>
            <dd>
              {sp.policeReported
                ? <>已报警{sp.policeReportAt ? `（${fmtDate(sp.policeReportAt)}）` : ''}{sp.policeReportNo ? ` · 回执号：${sp.policeReportNo}` : ''}{sp.policeNote ? ` · ${sp.policeNote}` : ''}</>
                : '暂未报警'}
            </dd>
            <dt>风险等级</dt><dd>{sp.riskLevel ? DV_RISK_LEVEL_LABELS[sp.riskLevel] : '—'}</dd>
            <dt>处置备注</dt><dd>{sp.notes || '—'}</dd>
          </dl>
        </div>
      )}

      {/* 社区工作人员：发起协同转介（司法所/妇联/派出所） */}
      {isStaff && kase.status !== 'CLOSED' && (
        <SafetyReferralForm kase={kase} safetyRefs={safetyRefs} onRun={onRun} />
      )}

      {/* 协同转介节点 + 授权人员管理 + 回访 */}
      <h3>协同转介节点与授权人员</h3>
      {safetyRefs.length === 0 ? <Empty text="尚未发起协同转介" /> : (
        <table className="table">
          <thead><tr><th>协同单位</th><th>状态</th><th>接收人</th><th>授权可见人员</th><th>回访安排</th>{isStaff && <th>授权管理</th>}</tr></thead>
          <tbody>
            {safetyRefs.map((r: any) => (
              <tr key={r.id}>
                <td>{REFERRAL_TYPE_LABELS[r.type] || r.type}<div className="muted" style={{ fontSize: 12 }}>{r.toUnit}</div></td>
                <td><Badge text={REFERRAL_STATUS_LABELS[r.status]} cls="badge-purple" /></td>
                <td>{r.acceptedBy ? r.acceptedBy.name : <span className="muted">待接收</span>}</td>
                <td style={{ fontSize: 12 }}>
                  {(r.grants || []).filter((g: any) => !g.revokedAt).length === 0
                    ? <span className="muted">暂无</span>
                    : (r.grants || []).filter((g: any) => !g.revokedAt).map((g: any) => (
                      <span key={g.id} className="chip">{g.user.name}
                        {isStaff && <button className="link-btn" onClick={() => onRun(() => api(`/referrals/${r.id}/grants`, { method: 'POST', body: JSON.stringify({ userId: g.userId, revoke: true }) }), '已撤销授权')}>×</button>}
                      </span>
                    ))}
                </td>
                <td style={{ fontSize: 12 }}>
                  {(r.followUps || []).length === 0 ? <span className="muted">默认接收后 7 天回访</span> :
                    r.followUps.map((f: any) => (
                      <div key={f.id}>{f.doneAt ? '✓ ' : '计划 '}{fmtDate(f.scheduledAt)}{f.result ? `：${f.result}` : ''}</div>
                    ))}
                </td>
                {isStaff && (
                  <td><GrantUserPicker r={r} allUsers={allUsers} onRun={onRun} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isUnit && (
        <p className="muted" style={{ fontSize: 12 }}>本单位接收后即在下方「转介记录」中办理接收/退回、安排并登记回访；接收人自动获得联系方式与住址查看授权。</p>
      )}
    </div>
  )
}

function SafetyPlanForm({ kase, onRun }: any) {
  const existing = kase.safetyPlan || {}
  const [form, setForm] = useState<any>({
    emergencyContactName: existing.emergencyContactName || '',
    emergencyContactPhone: existing.emergencyContactPhone || '',
    emergencyContactRel: existing.emergencyContactRel || '',
    shelterName: existing.shelterName || '',
    shelterAddress: existing.shelterAddress || '',
    shelterArranged: !!existing.shelterArranged,
    policeReported: !!existing.policeReported,
    policeReportNo: existing.policeReportNo || '',
    policeReportAt: existing.policeReportAt ? existing.policeReportAt.slice(0, 10) : '',
    policeNote: existing.policeNote || '',
    riskLevel: existing.riskLevel || 'HIGH',
    notes: existing.notes || '',
  })
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))
  return (
    <form className="mt8" style={{ borderTop: '1px dashed var(--border)', paddingTop: 10 }}
      onSubmit={(e) => { e.preventDefault(); onRun(() => api(`/cases/${kase.id}/safety-plan`, { method: 'POST', body: JSON.stringify(form) }), '安全信息已记录') }}>
      <h3>① 记录安全联系人 / 临时住所 / 报警情况</h3>
      <div className="form-grid">
        <div>
          <label className="label">安全联系人姓名</label>
          <input className="input" value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} placeholder="如：其姐李某某" />
        </div>
        <div>
          <label className="label">安全联系人电话</label>
          <input className="input" value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} placeholder="应急可联系号码" />
        </div>
        <div>
          <label className="label">与申请人关系</label>
          <input className="input" value={form.emergencyContactRel} onChange={(e) => set('emergencyContactRel', e.target.value)} placeholder="如：姐姐/邻居/社区民警" />
        </div>
        <div>
          <label className="label">临时安置点/庇护场所</label>
          <input className="input" value={form.shelterName} onChange={(e) => set('shelterName', e.target.value)} placeholder="如：区反家暴庇护中心" />
        </div>
        <div>
          <label className="label">临时住所地址（授权人员可见）</label>
          <input className="input" value={form.shelterAddress} onChange={(e) => set('shelterAddress', e.target.value)} />
        </div>
        <div>
          <label className="label">风险等级</label>
          <select className="input" value={form.riskLevel} onChange={(e) => set('riskLevel', e.target.value)}>
            {Object.entries(DV_RISK_LEVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="checks mt8">
        <label><input type="checkbox" checked={form.shelterArranged} onChange={(e) => set('shelterArranged', e.target.checked)} /> 已安排临时住所</label>
        <label><input type="checkbox" checked={form.policeReported} onChange={(e) => set('policeReported', e.target.checked)} /> 已报警</label>
      </div>
      {form.policeReported && (
        <div className="form-grid mt8">
          <div>
            <label className="label">报警时间</label>
            <input className="input" type="date" value={form.policeReportAt} onChange={(e) => set('policeReportAt', e.target.value)} />
          </div>
          <div>
            <label className="label">报警回执/受案编号</label>
            <input className="input" value={form.policeReportNo} onChange={(e) => set('policeReportNo', e.target.value)} />
          </div>
          <div>
            <label className="label">报警处置情况</label>
            <input className="input" value={form.policeNote} onChange={(e) => set('policeNote', e.target.value)} placeholder="如：已出具告诫书" />
          </div>
        </div>
      )}
      <label className="label mt8">安全处置备注</label>
      <textarea className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="当前处境、加害人动向、安全计划等" />
      <div className="btn-row mt8">
        <button className="btn btn-primary btn-sm">{kase.safetyPlan ? '更新安全信息' : '保存安全信息'}</button>
      </div>
    </form>
  )
}

function SafetyReferralForm({ kase, safetyRefs, onRun }: any) {
  const [units, setUnits] = useState<string[]>(['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'])
  const [reason, setReason] = useState('')
  const toggle = (t: string) => setUnits((u) => (u.includes(t) ? u.filter((x) => x !== t) : [...u, t]))
  const existingTypes = new Set(safetyRefs.map((r: any) => r.type))
  const remaining = SAFETY_UNITS.filter((u) => !existingTypes.has(u.type))
  return (
    <form className="mt8" style={{ borderTop: '1px dashed var(--border)', paddingTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault()
        const picked = units.filter((u) => !existingTypes.has(u))
        if (!picked.length) return
        onRun(() => api(`/cases/${kase.id}/safety-referrals`, { method: 'POST', body: JSON.stringify({ units: picked, reason }) }), '协同转介已发起，律师将与协同单位共同推进')
      }}>
      <h3>② 转介司法所 / 妇联 / 派出所协同处理</h3>
      {!kase.safetyPlan && <div className="alert alert-orange" style={{ marginTop: 0 }}>请先在上方记录安全联系人/临时住所/报警情况，再发起协同转介。</div>}
      <div className="checks">
        {SAFETY_UNITS.map((u) => (
          <label key={u.type} style={existingTypes.has(u.type) ? { color: 'var(--muted)' } : undefined}>
            <input type="checkbox" checked={units.includes(u.type)} disabled={existingTypes.has(u.type)} onChange={() => toggle(u.type)} />
            {u.label}{existingTypes.has(u.type) ? '（已转介）' : ''}
          </label>
        ))}
      </div>
      <input className="input mt8" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="转介说明（可选），如：申请人身安全保护令、请求庇护与告诫" />
      <div className="btn-row mt8">
        <button className="btn btn-primary btn-sm" disabled={!kase.safetyPlan || remaining.length === 0}>发起协同转介</button>
        <span className="muted" style={{ fontSize: 12 }}>发起后案件不再仅由律师孤立推进；接收单位 7 天后自动列入回访。</span>
      </div>
    </form>
  )
}

function GrantUserPicker({ r, allUsers, onRun }: any) {
  const roleForType: Record<string, string> = { JUDICIAL: 'JUDICIAL', WOMEN_FEDERATION: 'WOMEN_FEDERATION', POLICE: 'POLICE' }
  const role = roleForType[r.type]
  const grantedIds = new Set((r.grants || []).filter((g: any) => !g.revokedAt).map((g: any) => g.userId))
  const candidates = (allUsers || []).filter((u: any) => u.role === role && !grantedIds.has(u.id))
  const [userId, setUserId] = useState('')
  if (!role || candidates.length === 0) return <span className="muted" style={{ fontSize: 12 }}>无可追加授权人员</span>
  return (
    <div className="row" style={{ gap: 4 }}>
      <select className="input" style={{ width: 150 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">选择本单位人员…</option>
        {candidates.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <button className="btn btn-sm" disabled={!userId} onClick={() => { onRun(() => api(`/referrals/${r.id}/grants`, { method: 'POST', body: JSON.stringify({ userId }) }), '已授权该人员查看联系方式与住址'); setUserId('') }}>授权</button>
    </div>
  )
}
