// 特殊案件规则引擎：欠薪群体、家庭暴力、老人赡养、未成年人权益等
// 决定保密级别、优先级与协同单位任务。

export interface RuleInput {
  urgency?: string
  source?: string
  isDomesticViolence?: boolean
  isWageArrearsGroup?: boolean
  isElderlySupport?: boolean
  isMinorRights?: boolean
  involvesMinor?: boolean
  opponentSued?: boolean
  statuteOfLimitations?: Date | string | null
}

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 }

export function daysUntil(date?: Date | string | null): number | null {
  if (!date) return null
  const d = new Date(date)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

export function computeSpecialRules(input: RuleInput) {
  let priority = input.urgency || 'NORMAL'
  let confidentiality = 'NORMAL'
  const reasons: string[] = []
  const bump = (p: string) => {
    if (PRIORITY_RANK[p] > PRIORITY_RANK[priority]) priority = p
  }

  if (input.isDomesticViolence) {
    priority = 'URGENT'
    confidentiality = 'STRICT'
    reasons.push('家庭暴力风险：最高优先级 + 严格保密（对未承办人员隐藏申请人身份）')
  }
  if (input.isMinorRights || input.involvesMinor) {
    bump('HIGH')
    if (confidentiality === 'NORMAL') confidentiality = 'CONFIDENTIAL'
    reasons.push('涉未成年人：保密处理 + 高优先级')
  }
  if (input.isWageArrearsGroup) {
    bump('HIGH')
    reasons.push('欠薪群体：高优先级，联动劳动监察部门')
  }
  if (input.isElderlySupport) {
    bump('HIGH')
    reasons.push('老人赡养：高优先级，可安排志愿者上门协助')
  }
  if (input.opponentSued) {
    bump('HIGH')
    reasons.push('对方已经起诉：需尽快应诉')
  }
  const days = daysUntil(input.statuteOfLimitations)
  if (days !== null && days <= 30) {
    priority = 'URGENT'
    reasons.push(`诉讼时效临近（剩余 ${Math.max(days, 0)} 天）：升级为紧急`)
  }
  return { priority, confidentiality, reasons }
}

export interface AutoTask {
  type: string
  title: string
  assigneeRole: string
  description?: string
  dueDays?: number
}

// 初审分流后自动生成的协同任务（把居民/工作人员/律师/司法所/志愿者放进同一服务单）
export function buildAutoTasks(c: RuleInput): AutoTask[] {
  const tasks: AutoTask[] = []
  if (c.isDomesticViolence) {
    tasks.push({
      type: 'COORDINATION',
      title: '联动妇联/公安/司法所建立安全保护协作',
      assigneeRole: 'JUDICIAL',
      description: '家暴风险案件，需多单位协同保护申请人人身安全，注意保密',
      dueDays: 2,
    })
  }
  if (c.isElderlySupport || c.source === 'OFFLINE_PAPER') {
    tasks.push({
      type: 'HOME_VISIT',
      title: '上门协助老人整理与上传证据材料',
      assigneeRole: 'VOLUNTEER',
      description: '老人/残障居民无法线上操作，志愿者上门服务',
      dueDays: 3,
    })
  }
  if (c.isWageArrearsGroup) {
    tasks.push({
      type: 'COORDINATION',
      title: '联动劳动监察部门核实欠薪情况',
      assigneeRole: 'STAFF',
      dueDays: 3,
    })
  }
  if (c.isMinorRights || c.involvesMinor) {
    tasks.push({
      type: 'COORDINATION',
      title: '通知监护人参与并联动未成年人保护中心',
      assigneeRole: 'STAFF',
      dueDays: 2,
    })
  }
  const days = daysUntil(c.statuteOfLimitations)
  if (days !== null && days <= 30) {
    tasks.push({
      type: 'DEADLINE_WATCH',
      title: `诉讼时效临近（剩余 ${Math.max(days, 0)} 天）：优先处理`,
      assigneeRole: 'STAFF',
      dueDays: 1,
    })
  }
  return tasks
}

// 身份信息脱敏（保密案件对未承办律师/志愿者隐藏）
export function maskName(name?: string | null): string | null {
  if (!name) return name ?? null
  return name[0] + '*'.repeat(Math.max(name.length - 1, 1))
}

export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null
  if (phone.length < 7) return '***'
  return phone.slice(0, 3) + '****' + phone.slice(-4)
}
