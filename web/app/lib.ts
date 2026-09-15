'use client'

// ---------- API 客户端 ----------
export interface SessionUser {
  id: string
  username: string
  name: string
  role: string
  organization?: string
  street?: string
  phone?: string
  onLeave?: boolean
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('token')
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
}

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem('token', token)
  localStorage.setItem('user', JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { ...(opts.headers as any) }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const isForm = opts.body instanceof FormData
  if (!isForm && opts.body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}`, { ...opts, headers })
  if (res.status === 401) {
    clearSession()
    if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login'
    throw new Error('未登录或登录已过期')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    const msg = data?.message
    throw new Error(Array.isArray(msg) ? msg.join('；') : msg || `请求失败（${res.status}）`)
  }
  return res.json()
}

// ---------- 枚举中文标签 ----------
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: '平台管理员', RESIDENT: '居民', STAFF: '社区工作人员',
  LAWYER: '值班律师', JUDICIAL: '司法所', VOLUNTEER: '志愿者',
  WOMEN_FEDERATION: '妇联', POLICE: '派出所',
}
export const TYPE_LABELS: Record<string, string> = {
  LABOR_DISPUTE: '劳动纠纷', MARRIAGE_FAMILY: '婚姻家事', HOUSING_RENTAL: '房屋租赁',
  NEIGHBORHOOD_TORT: '邻里侵权', CONSUMER_RIGHTS: '消费维权', ADMIN_RECONSIDERATION: '行政复议',
}
export const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: '待初审', UNDER_REVIEW: '初审中', CLASSIFIED: '已分流',
  AWAITING_LAWYER: '待律师接案', IN_SERVICE: '服务进行中', MATERIAL_SUPPLEMENT: '待补正材料',
  REFERRED: '已转介', CLOSED: '已结案',
}
export const CATEGORY_LABELS: Record<string, string> = {
  LEGAL_AID: '法律援助', PEOPLES_MEDIATION: '人民调解', JUDICIAL_REFERRAL: '司法所转介',
  HOTLINE_ANSWER: '热线解答', COMMERCIAL_LAWYER: '商业律师服务',
}
export const SOURCE_LABELS: Record<string, string> = {
  ONLINE: '线上提交', COMMUNITY_EVENT: '社区活动现场', HOTLINE: '热线转入',
  OFFLINE_PAPER: '线下纸质补录', CROSS_STREET: '跨街道转入',
}
export const URGENCY_LABELS: Record<string, string> = { LOW: '低', NORMAL: '一般', HIGH: '较急', URGENT: '紧急' }
export const PRIORITY_LABELS: Record<string, string> = { LOW: '低', NORMAL: '普通', HIGH: '高', URGENT: '紧急' }
export const CONF_LABELS: Record<string, string> = { NORMAL: '普通', CONFIDENTIAL: '保密', STRICT: '严格保密' }
export const MATERIAL_STATUS_LABELS: Record<string, string> = {
  MISSING: '待补交', RECEIVED: '已提交待核验', NEEDS_CORRECTION: '需补正', VERIFIED: '已核验',
}
export const TASK_TYPE_LABELS: Record<string, string> = {
  MATERIAL_SUPPLEMENT: '材料补正', HOME_VISIT: '上门协助', CONFLICT_CHECK: '利益冲突核查',
  FOLLOW_UP: '回访', COORDINATION: '多单位协同', REASSIGNMENT: '重新指派', DEADLINE_WATCH: '期限盯办', OTHER: '其他',
}
export const TASK_STATUS_LABELS: Record<string, string> = { OPEN: '待处理', IN_PROGRESS: '处理中', DONE: '已完成', CANCELLED: '已取消' }
export const REFERRAL_STATUS_LABELS: Record<string, string> = { PENDING: '待接收', ACCEPTED: '已接收', REJECTED: '已退回', COMPLETED: '已办结' }
export const REFERRAL_TYPE_LABELS: Record<string, string> = { JUDICIAL: '司法所转介', CROSS_STREET: '跨街道转介', WOMEN_FEDERATION: '妇联协同', POLICE: '派出所协同', OTHER_ORG: '其他单位' }
export const DV_SIGNAL_LABELS: Record<string, string> = {
  threat: '存在威胁/恐吓言辞', harm: '存在伤害/暴力描述', control: '存在控制财产/经济控制描述',
}
export const DV_RISK_LEVEL_LABELS: Record<string, string> = { HIGH: '高风险', MEDIUM: '中风险', LOW: '低风险' }
export const APPT_STATUS_LABELS: Record<string, string> = { PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消' }
export const RISK_LABELS: Record<string, string> = { NONE: '无风险', LOW: '较低', MEDIUM: '中等', HIGH: '高风险', EXPIRED: '已逾期' }
export const INTENT_LABELS: Record<string, string> = { WILLING: '愿意立即启动程序', NOT_YET: '暂缓考虑', DECLINED: '放弃申请' }
export const CHANNEL_LABELS: Record<string, string> = { PHONE: '电话', VISIT: '上门', MESSAGE: '平台消息', OTHER: '其他' }
export const TIMELINESS_LABELS: Record<string, string> = { TIMELY: '提醒及时', LATE: '临近才提醒', MISSED: '逾期才提醒' }

// ---------- 展示辅助 ----------
export function fmtDate(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function fmtDateTime(d?: string | null): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${fmtDate(d)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

export function daysLeft(d?: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000)
}

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    SUBMITTED: 'badge-orange', UNDER_REVIEW: 'badge-orange', CLASSIFIED: 'badge-blue',
    AWAITING_LAWYER: 'badge-purple', IN_SERVICE: 'badge-blue', MATERIAL_SUPPLEMENT: 'badge-orange',
    REFERRED: 'badge-purple', CLOSED: 'badge-green',
  }
  return map[status] || 'badge-gray'
}

export function priorityBadge(p: string): string {
  const map: Record<string, string> = { LOW: 'badge-gray', NORMAL: 'badge-blue', HIGH: 'badge-orange', URGENT: 'badge-red' }
  return map[p] || 'badge-gray'
}

export function confBadge(c: string): string {
  const map: Record<string, string> = { NORMAL: 'badge-gray', CONFIDENTIAL: 'badge-purple', STRICT: 'badge-red' }
  return map[c] || 'badge-gray'
}

export function materialStatusBadge(s: string): string {
  const map: Record<string, string> = { MISSING: 'badge-red', RECEIVED: 'badge-orange', NEEDS_CORRECTION: 'badge-orange', VERIFIED: 'badge-green' }
  return map[s] || 'badge-gray'
}

export function taskStatusBadge(s: string): string {
  const map: Record<string, string> = { OPEN: 'badge-orange', IN_PROGRESS: 'badge-blue', DONE: 'badge-green', CANCELLED: 'badge-gray' }
  return map[s] || 'badge-gray'
}

export function riskBadge(r?: string | null): string {
  const map: Record<string, string> = { LOW: 'badge-blue', MEDIUM: 'badge-orange', HIGH: 'badge-red', EXPIRED: 'badge-red' }
  return map[r || ''] || 'badge-gray'
}

export function timelinessBadge(t: string): string {
  const map: Record<string, string> = { TIMELY: 'badge-green', LATE: 'badge-orange', MISSED: 'badge-red' }
  return map[t] || 'badge-gray'
}

export function specialFlags(kase: any): string[] {
  const flags: string[] = []
  if (kase.isDomesticViolence) flags.push('家庭暴力风险')
  if (kase.isWageArrearsGroup) flags.push('欠薪群体')
  if (kase.isElderlySupport) flags.push('老人赡养')
  if (kase.isMinorRights) flags.push('未成年人权益')
  if (kase.involvesMinor && !kase.isMinorRights) flags.push('涉未成年人')
  if (kase.isDisabled) flags.push('残障人士')
  if (kase.opponentSued) flags.push('对方已起诉')
  return flags
}

// 家暴风险信号客户端预检（与后端 rules.ts 关键词保持一致，用于录入即时提示）
const DV_KW = {
  threat: ['威胁', '恐吓', '扬言', '弄死', '打死', '杀了', '杀人', '同归于尽', '报复', '不让好过', '小心点', '收拾你', '砍'],
  harm: ['打我', '殴打', '家暴', '家庭暴力', '扇耳光', '推搡', '踢', '动手', '受伤', '伤痕', '淤青', '伤情', '刀', '棍', '掐', '烫', '施暴'],
  control: ['控制财产', '控制工资', '工资卡', '银行卡', '没收', '不给钱', '经济控制', '控制经济', '转移财产', '霸占', '扣押', '身份证', '户口本', '锁在门外', '赶出家门', '净身出户', '不让上班', '软禁'],
}

export function detectDvClient(type?: string, description?: string) {
  const text = description || ''
  if (type && type !== 'MARRIAGE_FAMILY') return { threat: false, harm: false, control: false, matched: [], has: false }
  const hit = (words: string[]) => words.filter((w) => text.includes(w))
  const threat = hit(DV_KW.threat), harm = hit(DV_KW.harm), control = hit(DV_KW.control)
  const matched = [...threat, ...harm, ...control]
  return { threat: threat.length > 0, harm: harm.length > 0, control: control.length > 0, matched, has: matched.length > 0 }
}
