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
export const REFERRAL_TYPE_LABELS: Record<string, string> = { JUDICIAL: '司法所转介', CROSS_STREET: '跨街道转介', OTHER_ORG: '其他单位' }
export const APPT_STATUS_LABELS: Record<string, string> = { PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消' }

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
