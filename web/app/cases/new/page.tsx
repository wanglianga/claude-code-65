'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ErrorBox, Nav } from '../../components'
import { api, getUser, SOURCE_LABELS, TYPE_LABELS, URGENCY_LABELS, SessionUser } from '../../lib'

const EMPTY_KEY_DATE = { label: '', date: '', kind: 'other' }

export default function NewCasePage() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<any>({
    title: '', type: 'LABOR_DISPUTE', description: '', urgency: 'NORMAL',
    source: 'OFFLINE_PAPER', applicantName: '', applicantPhone: '',
    familyIncome: '', opposingParties: '', statuteOfLimitations: '', incidentDate: '', deadlineNotes: '', street: '',
    isDisabled: false, involvesMinor: false, isWageArrearsGroup: false,
    isDomesticViolence: false, isElderlySupport: false, isMinorRights: false, opponentSued: false,
  })
  const [keyDates, setKeyDates] = useState<any[]>([{ ...EMPTY_KEY_DATE }])

  useEffect(() => {
    const u = getUser()
    if (!u) { router.replace('/login'); return }
    if (!['RESIDENT', 'STAFF', 'ADMIN'].includes(u.role)) { router.replace('/cases'); return }
    setUser(u)
    if (u.street) setForm((f: any) => ({ ...f, street: u.street }))
  }, [router])

  if (!user) return null
  const isStaff = ['STAFF', 'ADMIN'].includes(user.role)
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload: any = {
        ...form,
        familyIncome: form.familyIncome === '' ? undefined : Number(form.familyIncome),
        statuteOfLimitations: form.statuteOfLimitations || undefined,
        incidentDate: form.incidentDate || undefined,
        keyDates: keyDates.filter((k) => k.label && k.date),
      }
      if (!isStaff) { delete payload.source; delete payload.applicantName; delete payload.applicantPhone }
      const kase = await api('/cases', { method: 'POST', body: JSON.stringify(payload) })
      router.push(`/cases/${kase.id}`)
    } catch (err: any) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const boolField = (key: string, label: string, warn = false) => (
    <label className={warn ? 'warn' : ''}>
      <input type="checkbox" checked={!!form[key]} onChange={(e) => set(key, e.target.checked)} /> {label}
    </label>
  )

  return (
    <>
      <Nav />
      <div className="container">
        <div className="card">
          <h2>{isStaff ? '线下补录 / 代录咨询（活动现场、热线转入、纸质材料、跨街道转入）' : '提交法律援助咨询'}</h2>
          <form onSubmit={submit}>
            {isStaff && (
              <>
                <h3>登记来源与申请人</h3>
                <div className="form-grid">
                  <div>
                    <label className="label">来源渠道 *</label>
                    <select className="input" value={form.source} onChange={(e) => set('source', e.target.value)}>
                      {['COMMUNITY_EVENT', 'HOTLINE', 'OFFLINE_PAPER', 'CROSS_STREET'].map((s) => (
                        <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">申请人姓名 *</label>
                    <input className="input" value={form.applicantName} onChange={(e) => set('applicantName', e.target.value)} required />
                  </div>
                  <div>
                    <label className="label">申请人联系电话</label>
                    <input className="input" value={form.applicantPhone} onChange={(e) => set('applicantPhone', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            <h3>诉求信息</h3>
            <div className="form-grid">
              <div>
                <label className="label">咨询类型 *</label>
                <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">紧急程度 *</label>
                <select className="input" value={form.urgency} onChange={(e) => set('urgency', e.target.value)}>
                  {Object.entries(URGENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">所属街道</label>
                <input className="input" value={form.street} onChange={(e) => set('street', e.target.value)} placeholder="如：朝阳街道" />
              </div>
            </div>
            <label className="label">标题 *</label>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="一句话概括诉求，如：公司拖欠三个月工资" required />
            <label className="label">诉求与案件事实 *</label>
            <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="请描述事情经过、诉求、涉及金额、对方情况等" required />

            <h3>资格与特殊情形（用于法律援助资格初审与特殊规则）</h3>
            <div className="form-grid">
              <div>
                <label className="label">家庭月收入（元）</label>
                <input className="input" type="number" min="0" value={form.familyIncome} onChange={(e) => set('familyIncome', e.target.value)} />
              </div>
              <div>
                <label className="label">冲突主体（对方当事人）</label>
                <input className="input" value={form.opposingParties} onChange={(e) => set('opposingParties', e.target.value)} placeholder="如：某某公司 / 邻居王某" />
              </div>
            </div>
            <div className="checks">
              {boolField('isDisabled', '申请人残障')}
              {boolField('involvesMinor', '涉及未成年人')}
              {boolField('isWageArrearsGroup', '欠薪群体', true)}
              {boolField('isDomesticViolence', '家庭暴力风险', true)}
              {boolField('isElderlySupport', '老人赡养', true)}
              {boolField('isMinorRights', '未成年人权益', true)}
              {boolField('opponentSued', '对方已经起诉', true)}
            </div>
            {(form.isDomesticViolence || form.isWageArrearsGroup || form.isElderlySupport || form.isMinorRights) && (
              <div className="alert alert-orange mt8">
                已勾选特殊情形：平台将自动提升优先级、加强保密级别，并在分流后生成对应协同任务（如家暴联动妇联/公安、老人上门协助、欠薪联动劳动监察）。
              </div>
            )}

            <h3>关键时间节点</h3>
            <div className="form-grid">
              <div>
                <label className="label">事件发生日期（欠薪开始日 / 租约到期日等）</label>
                <input className="input" type="date" value={form.incidentDate} onChange={(e) => set('incidentDate', e.target.value)} />
              </div>
              <div>
                <label className="label">诉讼时效届满日（如知道）</label>
                <input className="input" type="date" value={form.statuteOfLimitations} onChange={(e) => set('statuteOfLimitations', e.target.value)} />
              </div>
              <div>
                <label className="label">其他期限说明</label>
                <input className="input" value={form.deadlineNotes} onChange={(e) => set('deadlineNotes', e.target.value)} placeholder="如：仲裁申请期限、举证期限等" />
              </div>
            </div>
            {(form.type === 'LABOR_DISPUTE' || form.type === 'HOUSING_RENTAL') && form.incidentDate && !form.statuteOfLimitations && (
              <div className="alert alert-blue mt8">
                平台将按{form.type === 'LABOR_DISPUTE' ? '劳动仲裁时效（1年）' : '民事诉讼时效（3年）'}自事件发生日推算关键期限，并进行期限风险评估。
              </div>
            )}
            {keyDates.map((k, i) => (
              <div className="row mt8" key={i}>
                <input className="input" style={{ width: 240 }} placeholder="节点名称，如：开庭日" value={k.label}
                  onChange={(e) => setKeyDates(keyDates.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="input" style={{ width: 170 }} type="date" value={k.date}
                  onChange={(e) => setKeyDates(keyDates.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                <select className="input" style={{ width: 140 }} value={k.kind}
                  onChange={(e) => setKeyDates(keyDates.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                  <option value="other">一般节点</option>
                  <option value="statute">时效相关</option>
                  <option value="court">开庭/应诉</option>
                </select>
                <button type="button" className="btn btn-sm" onClick={() => setKeyDates(keyDates.filter((_, j) => j !== i))}>删除</button>
              </div>
            ))}
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => setKeyDates([...keyDates, { ...EMPTY_KEY_DATE }])}>+ 添加时间节点</button>
            </div>

            <ErrorBox error={error} />
            <div className="btn-row mt16">
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? '提交中…' : isStaff ? '补录并提交' : '提交咨询'}
              </button>
              <button className="btn" type="button" onClick={() => router.back()}>取消</button>
            </div>
            <p className="muted mt8" style={{ fontSize: 12 }}>
              提交后可在案件详情中继续上传证据材料；社区工作人员将进行资格初审并分流。
            </p>
          </form>
        </div>
      </div>
    </>
  )
}
