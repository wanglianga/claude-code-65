// 特殊案件规则引擎：欠薪群体、家庭暴力、老人赡养、未成年人权益等
// 决定保密级别、优先级与协同单位任务。

export interface RuleInput {
  urgency?: string
  source?: string
  type?: string
  incidentDate?: Date | string | null
  keyDates?: Array<{ kind?: string; date: Date | string }>
  isDomesticViolence?: boolean
  isWageArrearsGroup?: boolean
  isElderlySupport?: boolean
  isMinorRights?: boolean
  involvesMinor?: boolean
  opponentSued?: boolean
  statuteOfLimitations?: Date | string | null
}

// 各类案件法定关键期限（年）：劳动仲裁时效 1 年；租赁等普通民事诉讼时效 3 年
export const LIMITATION_YEARS: Record<string, number> = {
  LABOR_DISPUTE: 1,
  HOUSING_RENTAL: 3,
}

// 推算关键期限：明确诉讼时效 > 关键时间节点（时效/开庭类） > 事件日期 + 法定时效
export function estimateDeadline(input: {
  type?: string
  incidentDate?: Date | string | null
  statuteOfLimitations?: Date | string | null
  keyDates?: Array<{ kind?: string; date: Date | string }>
}): Date | null {
  if (input.statuteOfLimitations) {
    const d = new Date(input.statuteOfLimitations)
    if (!isNaN(d.getTime())) return d
  }
  const statutory = (input.keyDates || [])
    .filter((k) => k.kind === 'statute' || k.kind === 'court')
    .map((k) => new Date(k.date))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0]
  if (statutory) return statutory
  const years = input.type ? LIMITATION_YEARS[input.type] : undefined
  if (years && input.incidentDate) {
    const d = new Date(input.incidentDate)
    if (!isNaN(d.getTime())) {
      d.setFullYear(d.getFullYear() + years)
      return d
    }
  }
  return null
}

export interface DeadlineRisk {
  level: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXPIRED'
  deadline: Date | null
  daysLeft: number | null
  reasons: string[]
}

// 期限风险评估：事件日期（推算期限）× 已有证据 × 当前节点
export function assessDeadlineRisk(kase: {
  type?: string
  status?: string
  incidentDate?: Date | string | null
  statuteOfLimitations?: Date | string | null
  keyDates?: Array<{ kind?: string; date: Date | string }>
  opponentSued?: boolean
  materials?: Array<{ status: string }>
}): DeadlineRisk {
  const deadline = estimateDeadline(kase)
  if (!deadline) return { level: 'NONE', deadline: null, daysLeft: null, reasons: [] }
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000)
  const estimated = !kase.statuteOfLimitations && !!kase.incidentDate && !!LIMITATION_YEARS[kase.type || '']
  const typeLabel = kase.type === 'LABOR_DISPUTE' ? '劳动仲裁时效（1年）' : kase.type === 'HOUSING_RENTAL' ? '民事诉讼时效（3年）' : '关键期限'
  const reasons: string[] = []

  if (['CLOSED', 'REFERRED'].includes(kase.status || '')) {
    return { level: 'NONE', deadline, daysLeft, reasons: ['案件已办结/已转介，期限风险解除'] }
  }

  let level: DeadlineRisk['level']
  if (daysLeft < 0) {
    level = 'EXPIRED'
    reasons.push(`${typeLabel}已于 ${-daysLeft} 天前届满，居民可能已错过关键期限`)
  } else if (daysLeft <= 30) {
    level = 'HIGH'
    reasons.push(`距${typeLabel}届满仅剩 ${daysLeft} 天`)
  } else if (daysLeft <= 90) {
    level = 'MEDIUM'
    reasons.push(`距${typeLabel}届满还有 ${daysLeft} 天`)
  } else {
    level = 'LOW'
    reasons.push(`距${typeLabel}届满尚有 ${daysLeft} 天`)
  }
  if (estimated) reasons.push('期限按法定时效自事件发生日推算')

  // 证据因素：期限临近但无任何已核验证据 → 升级
  const materials = kase.materials || []
  const verified = materials.filter((m) => m.status === 'VERIFIED').length
  if (level !== 'EXPIRED' && daysLeft <= 90 && verified === 0) {
    reasons.push('尚无已核验证据，举证准备不足')
    if (level === 'MEDIUM') level = 'HIGH'
  }
  // 当前节点因素
  if (['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status || '') && ['HIGH', 'EXPIRED'].includes(level)) {
    reasons.push('案件尚未完成初审分流，需优先处理避免被普通咨询淹没')
  }
  if (kase.opponentSued && level !== 'EXPIRED') {
    reasons.push('对方已起诉，应诉期限紧迫')
  }
  return { level, deadline, daysLeft, reasons }
}

// 各类案件标准材料清单（期限风险案件一键生成）
export const MATERIAL_CHECKLISTS: Record<string, string[]> = {
  LABOR_DISPUTE: ['劳动合同或用工证明', '工资银行流水/工资条', '考勤记录', '社保缴纳记录', '欠薪欠条或结算单', '沟通记录（微信/短信截图）'],
  HOUSING_RENTAL: ['房屋租赁合同', '押金收据/转账记录', '租金支付记录', '房屋交接单/现场照片', '沟通记录（微信/短信截图）'],
  MARRIAGE_FAMILY: ['结婚证/户口本', '报警回执或伤情诊断证明', '财产收入证明', '子女出生证明（涉抚养）'],
  NEIGHBORHOOD_TORT: ['现场照片/视频', '医疗诊断证明', '费用票据', '证人联系方式'],
  CONSUMER_RIGHTS: ['购物凭证/服务合同', '付款记录', '商品照片/检测报告', '沟通记录'],
  ADMIN_RECONSIDERATION: ['行政决定书', '送达回证', '相关证据材料', '身份证明'],
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
  const estimatedDeadline = estimateDeadline(input)
  const days = daysUntil(estimatedDeadline)
  if (days !== null && days <= 30) {
    priority = 'URGENT'
    reasons.push(
      days < 0
        ? `关键期限已届满 ${-days} 天：升级为紧急`
        : `诉讼时效临近（剩余 ${days} 天）：升级为紧急`,
    )
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
      title: '记录家暴安全信息（安全联系人/临时住所/报警情况）并转介司法所、妇联或派出所协同',
      assigneeRole: 'STAFF',
      description: '家暴风险案件，律师咨询不得孤立推进，先完成安全信息记录与协同转介',
      dueDays: 1,
    })
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

export function maskAddress(addr?: string | null): string | null {
  if (!addr) return addr ?? null
  // 隐藏详细住址（门牌号等），仅保留粗粒度位置
  const cut = addr.search(/[0-9０-９]+(?:号|栋|幢|楼|室|单元)/)
  if (cut > 0) return addr.slice(0, cut).trim() + '（详细地址已隐藏）'
  return addr.length > 12 ? addr.slice(0, 12) + '…（详细地址已隐藏）' : '（详细地址已隐藏）'
}

// ---------- 家暴风险信号识别 ----------
// 婚姻咨询中出现「威胁、伤害或控制财产」描述时自动识别，提示社区工作人员介入。
export const DV_KEYWORDS = {
  // 威胁 / 恐吓
  threat: ['威胁', '恐吓', '扬言', '弄死', '打死', '杀了', '杀人', '同归于尽', '报复', '不让好过', '小心点', '收拾你', '砍'],
  // 伤害 / 暴力
  harm: ['打我', '殴打', '家暴', '家庭暴力', '扇耳光', '推搡', '踢', '动手', '受伤', '伤痕', '淤青', '伤情', '刀', '棍', '掐', '烫', '施暴'],
  // 控制财产 / 经济控制
  control: [
    '控制财产', '控制工资', '工资卡', '银行卡', '没收', '不给钱', '经济控制', '控制经济',
    '转移财产', '霸占', '扣押', '身份证', '户口本', '锁在门外', '赶出家门', '净身出户', '不让上班', '软禁',
  ],
}

export interface DvSignal {
  threat: boolean
  harm: boolean
  control: boolean
  matched: string[]
  has: boolean
}

export function detectDvSignals(type?: string | null, description?: string | null): DvSignal {
  const text = description || ''
  // 仅对婚姻家事咨询做关键词识别
  const isMarriage = !type || type === 'MARRIAGE_FAMILY'
  const hit = (words: string[]) => (isMarriage ? words.filter((w) => text.includes(w)) : [])
  const threatWords = hit(DV_KEYWORDS.threat)
  const harmWords = hit(DV_KEYWORDS.harm)
  const controlWords = hit(DV_KEYWORDS.control)
  const matched = [...threatWords, ...harmWords, ...controlWords]
  return {
    threat: threatWords.length > 0,
    harm: harmWords.length > 0,
    control: controlWords.length > 0,
    matched,
    has: matched.length > 0,
  }
}

export const DV_SIGNAL_LABELS: Record<string, string> = {
  threat: '存在威胁/恐吓言辞',
  harm: '存在伤害/暴力描述',
  control: '存在控制财产/经济控制描述',
}
