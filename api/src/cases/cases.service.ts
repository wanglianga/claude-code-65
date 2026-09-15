import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { JwtUser } from '../common'
import {
  assessDeadlineRisk,
  buildAutoTasks,
  computeSpecialRules,
  detectDvSignals,
  maskAddress,
  maskName,
  maskPhone,
  MATERIAL_CHECKLISTS,
} from './rules'

// 协同单位角色 → 转介类型
const UNIT_ROLE_TO_REFERRAL: Record<string, string> = {
  JUDICIAL: 'JUDICIAL',
  WOMEN_FEDERATION: 'WOMEN_FEDERATION',
  POLICE: 'POLICE',
}

// 家暴协同转介类型 → 默认接收单位名称
export const SAFETY_UNIT_LABELS: Record<string, string> = {
  JUDICIAL: '司法所',
  WOMEN_FEDERATION: '妇联',
  POLICE: '派出所',
}

// 转介接收后默认回访间隔（天）
const DEFAULT_FOLLOW_UP_DAYS = 7

// 严格解析工时等必填数值：空串、纯空格、null、undefined、布尔、非有限数、负数一律无效
function parseStrictHours(v: any): number | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null
  let n: number
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    n = Number(t)
  } else if (typeof v === 'number') {
    n = v
  } else {
    return null
  }
  return Number.isFinite(n) && n >= 0 ? n : null
}

const CASE_INCLUDE = {  resident: { select: { id: true, name: true, phone: true } },
  reviewedBy: { select: { id: true, name: true } },
  lawyer: { select: { id: true, name: true, organization: true, onLeave: true } },
  materials: { include: { uploadedBy: { select: { id: true, name: true, role: true } }, proxy: { include: { volunteer: { select: { id: true, name: true } } } } }, orderBy: { createdAt: 'asc' as const } },
  materialProxies: { include: { volunteer: { select: { id: true, name: true, phone: true } } }, orderBy: { createdAt: 'desc' as const } },
  keyDates: { orderBy: { date: 'asc' as const } },
  tasks: {
    include: {
      assignee: { select: { id: true, name: true, role: true } },
      createdBy: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  appointments: { include: { lawyer: { select: { id: true, name: true } } }, orderBy: { scheduledAt: 'asc' as const } },
  referrals: {
    include: {
      createdBy: { select: { id: true, name: true } },
      acceptedBy: { select: { id: true, name: true, role: true, organization: true } },
      grants: { include: { user: { select: { id: true, name: true, role: true, organization: true } } } },
      followUps: { orderBy: { scheduledAt: 'asc' as const } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  conflictChecks: { include: { lawyer: { select: { id: true, name: true } } }, orderBy: { checkedAt: 'desc' as const } },
  events: { include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
  archive: true,
  safetyPlan: true,
  serviceOrder: {
    include: { participants: { include: { user: { select: { id: true, name: true, role: true, organization: true } } } } },
  },
  reminders: { include: { remindedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' as const } },
}

@Injectable()
export class CasesService {
  constructor(private prisma: PrismaService) {}

  // ---------- 工具 ----------
  private async genCaseNo(): Promise<string> {
    const d = new Date()
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const count = await this.prisma.case.count({ where: { createdAt: { gte: start } } })
    return `LA${ymd}-${String(count + 1).padStart(4, '0')}`
  }

  private async event(caseId: string, actorId: string | null, action: string, detail?: string) {
    await this.prisma.caseEvent.create({ data: { caseId, actorId, action, detail } })
  }

  // 重新评估期限风险并持久化（提交/初审/材料核验变化时调用）
  private async refreshDeadlineRisk(caseId: string) {
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { materials: { select: { status: true } }, keyDates: true },
    })
    if (!kase) return null
    const risk = assessDeadlineRisk(kase)
    await this.prisma.case.update({
      where: { id: caseId },
      data: {
        deadlineRisk: risk.level,
        deadlineRiskReason: risk.reasons.join('；') || null,
        estimatedDeadline: risk.deadline,
      },
    })
    return risk
  }

  private async getCaseOr404(id: string) {
    const kase = await this.prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE })
    if (!kase) throw new NotFoundException('案件不存在')
    return kase
  }

  private assertCanView(kase: any, user: JwtUser) {
    if (['ADMIN', 'STAFF'].includes(user.role)) return
    if (user.role === 'RESIDENT') {
      if (kase.residentId !== user.sub) throw new ForbiddenException('只能查看自己的案件')
      return
    }
    if (['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'].includes(user.role)) {
      // 司法所保留跨案查看；妇联/派出所仅能查看已转介给本单位的案件
      if (user.role === 'JUDICIAL') return
      const wantType = UNIT_ROLE_TO_REFERRAL[user.role]
      const referred = (kase.referrals || []).some(
        (r: any) => r.type === wantType && ['PENDING', 'ACCEPTED', 'COMPLETED'].includes(r.status),
      )
      if (!referred) throw new ForbiddenException('该案件未转介给本单位，无权查看')
      return
    }
    if (user.role === 'LAWYER') {
      const inPool = kase.category === 'LEGAL_AID' && !kase.lawyerId &&
        ['CLASSIFIED', 'AWAITING_LAWYER', 'MATERIAL_SUPPLEMENT'].includes(kase.status)
      if (kase.lawyerId !== user.sub && !inPool) throw new ForbiddenException('无权查看该案件')
      return
    }
    if (user.role === 'VOLUNTEER') {
      const involved =
        kase.tasks.some((t) => t.assigneeId === user.sub || t.assigneeRole === 'VOLUNTEER') ||
        kase.serviceOrder?.participants.some((p) => p.userId === user.sub)
      if (!involved) throw new ForbiddenException('无权查看该案件')
      return
    }
    throw new ForbiddenException('无权查看该案件')
  }

  // 该查看者是否为家暴案件协同单位的「授权人员」（接收人或被单独授权者）
  private isAuthorizedUnitUser(kase: any, user: JwtUser): boolean {
    if (!kase.isDomesticViolence) return false
    const wantType = UNIT_ROLE_TO_REFERRAL[user.role]
    if (!wantType) return false
    return (kase.referrals || []).some(
      (r: any) =>
        r.isSafetyReferral &&
        r.type === wantType &&
        (r.acceptedById === user.sub ||
          (r.grants || []).some((g) => g.userId === user.sub && !g.revokedAt)),
    )
  }

  // 是否可查看申请人真实身份/联系方式/住址
  private canSeeIdentity(kase: any, user: JwtUser): boolean {
    if (['ADMIN', 'STAFF'].includes(user.role)) return true
    if (kase.residentId === user.sub) return true
    if (user.role === 'LAWYER' && kase.lawyerId === user.sub) return true
    if (this.isAuthorizedUnitUser(kase, user)) return true
    // 司法所对非家暴保密案件保留可见（既有规则）；家暴案件须为授权人员（上方已判定）
    if (user.role === 'JUDICIAL' && !kase.isDomesticViolence) return true
    return false
  }

  private maskIfNeeded(kase: any, user: JwtUser) {
    if (!kase || kase.confidentiality === 'NORMAL') return kase
    if (this.canSeeIdentity(kase, user)) return kase
    // 未授权人员：隐藏申请人身份、联系方式与住址
    kase.applicantName = maskName(kase.applicantName)
    kase.applicantPhone = maskPhone(kase.applicantPhone)
    kase.applicantAddress = maskAddress(kase.applicantAddress)
    if (kase.resident) {
      kase.resident.name = maskName(kase.resident.name)
      kase.resident.phone = maskPhone(kase.resident.phone)
    }
    return kase
  }

  // 安全处置信息含临时住所地址、紧急联系人等敏感内容，按角色/授权裁剪
  private filterSafetyPlan(kase: any, user: JwtUser) {
    if (!kase.safetyPlan) return kase
    const full =
      ['ADMIN', 'STAFF'].includes(user.role) ||
      kase.residentId === user.sub ||
      this.isAuthorizedUnitUser(kase, user)
    if (full) return kase
    const sp = { ...kase.safetyPlan }
    // 承办律师可见处置是否完成与风险等级，但不展示庇护地址、紧急联系人电话
    if (user.role === 'LAWYER' && kase.lawyerId === user.sub) {
      sp.shelterAddress = maskAddress(sp.shelterAddress)
      sp.emergencyContactPhone = maskPhone(sp.emergencyContactPhone)
    } else {
      kase.safetyPlan = null
      return kase
    }
    kase.safetyPlan = sp
    return kase
  }

  // ---------- 提交 ----------
  async create(user: JwtUser, dto: any) {
    const isStaffIntake = ['STAFF', 'ADMIN'].includes(user.role)
    const source = isStaffIntake ? (dto.source || 'OFFLINE_PAPER') : 'ONLINE'
    if (user.role !== 'RESIDENT' && !isStaffIntake) throw new ForbiddenException('当前角色不能提交咨询')

    const rules = computeSpecialRules(dto)
    // 家暴风险信号自动识别：婚姻家事咨询描述中出现威胁/伤害/控制财产关键词
    const signal = detectDvSignals(dto.type, dto.description)
    const isDv = !!dto.isDomesticViolence || signal.has
    const dvRules = isDv && !dto.isDomesticViolence ? computeSpecialRules({ ...dto, isDomesticViolence: true }) : rules
    const finalRules = isDv && !dto.isDomesticViolence ? dvRules : rules
    const caseNo = await this.genCaseNo()
    const dbUser = isStaffIntake ? null : await this.prisma.user.findUnique({ where: { id: user.sub } })
    const kase = await this.prisma.case.create({
      data: {
        caseNo,
        title: dto.title,
        type: dto.type,
        description: dto.description,
        source,
        urgency: dto.urgency || 'NORMAL',
        priority: finalRules.priority as any,
        confidentiality: finalRules.confidentiality as any,
        ruleNotes: finalRules.reasons.join('；') || null,
        applicantName: isStaffIntake ? dto.applicantName : user.name,
        applicantPhone: isStaffIntake ? dto.applicantPhone || null : dbUser?.phone || null,
        applicantAddress: dto.applicantAddress || null,
        residentId: isStaffIntake ? null : user.sub,
        familyIncome: dto.familyIncome ?? null,
        isDisabled: !!dto.isDisabled,
        involvesMinor: !!dto.involvesMinor,
        isWageArrearsGroup: !!dto.isWageArrearsGroup,
        isDomesticViolence: isDv,
        dvSignalThreat: signal.threat,
        dvSignalHarm: signal.harm,
        dvSignalControl: signal.control,
        dvSignalNote: signal.has ? signal.matched.join('、') : null,
        isElderlySupport: !!dto.isElderlySupport,
        isMinorRights: !!dto.isMinorRights,
        opponentSued: !!dto.opponentSued,
        opposingParties: dto.opposingParties || null,
        statuteOfLimitations: dto.statuteOfLimitations ? new Date(dto.statuteOfLimitations) : null,
        incidentDate: dto.incidentDate ? new Date(dto.incidentDate) : null,
        deadlineNotes: dto.deadlineNotes || null,
        street: dto.street || null,
        keyDates: dto.keyDates?.length
          ? { create: dto.keyDates.filter((k: any) => k.label && k.date).map((k: any) => ({ label: k.label, date: new Date(k.date), kind: k.kind || 'other' })) }
          : undefined,
      },
    })
    const sourceLabel: Record<string, string> = {
      ONLINE: '提交咨询', COMMUNITY_EVENT: '活动现场登记', HOTLINE: '热线转入登记',
      OFFLINE_PAPER: '线下纸质材料补录', CROSS_STREET: '跨街道转入登记',
    }
    await this.event(kase.id, user.sub, sourceLabel[source] || '提交咨询', isStaffIntake ? `工作人员代录（申请人：${dto.applicantName}）` : undefined)
    if (finalRules.reasons.length) {
      await this.event(kase.id, null, '命中特殊规则', finalRules.reasons.join('；'))
    }
    // 描述中识别出家暴风险信号：提示并生成社区工作人员安全处置待办
    if (signal.has) {
      const labels = [
        signal.threat && '威胁/恐吓',
        signal.harm && '伤害/暴力',
        signal.control && '控制财产/经济控制',
      ].filter(Boolean).join('、')
      await this.event(
        kase.id,
        null,
        '家暴风险信号识别',
        `婚姻家事咨询描述中检出${labels}相关表述（${signal.matched.slice(0, 6).join('、')}），已按家暴案件严格保密并提示社区工作人员记录安全信息、发起协同转介`,
      )
      await this.prisma.task.create({
        data: {
          caseId: kase.id,
          type: 'COORDINATION',
          title: '记录家暴安全信息（安全联系人/临时住所/报警情况）并转介司法所、妇联或派出所协同',
          description: `咨询描述中出现${labels}描述，律师咨询不得孤立推进，请先完成安全处置`,
          assigneeRole: 'STAFF',
          createdById: user.sub,
          dueDate: new Date(Date.now() + 1 * 86400000),
        },
      })
    }
    const risk = await this.refreshDeadlineRisk(kase.id)
    if (risk && ['HIGH', 'EXPIRED'].includes(risk.level)) {
      await this.event(kase.id, null, '期限风险评估', risk.reasons.join('；'))
    }
    return this.findOne(user, kase.id)
  }

  // ---------- 列表 ----------
  async findAll(user: JwtUser, q: any) {
    const where: any = {}
    if (q.status) where.status = q.status
    if (q.category) where.category = q.category
    if (q.type) where.type = q.type
    if (q.source) where.source = q.source
    if (q.special === 'dv') where.isDomesticViolence = true
    if (q.special === 'wage') where.isWageArrearsGroup = true
    if (q.special === 'elderly') where.isElderlySupport = true
    if (q.special === 'minor') where.OR = [{ isMinorRights: true }, { involvesMinor: true }]
    if (q.search) {
      where.AND = [{ OR: [{ title: { contains: q.search } }, { caseNo: { contains: q.search } }, { applicantName: { contains: q.search } }] }]
    }
    if (user.role === 'RESIDENT') where.residentId = user.sub
    else if (user.role === 'LAWYER') {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { lawyerId: user.sub },
            { category: 'LEGAL_AID', lawyerId: null, status: { in: ['CLASSIFIED', 'AWAITING_LAWYER', 'MATERIAL_SUPPLEMENT'] } },
          ],
        },
      ]
    } else if (user.role === 'VOLUNTEER') {
      where.OR = [
        { tasks: { some: { OR: [{ assigneeId: user.sub }, { assigneeRole: 'VOLUNTEER' }] } } },
        { serviceOrder: { participants: { some: { userId: user.sub } } } },
      ]
    } else if (user.role === 'WOMEN_FEDERATION' || user.role === 'POLICE') {
      // 妇联/派出所仅能看到转介给本单位的案件（司法所保留跨案查看）
      const wantType = UNIT_ROLE_TO_REFERRAL[user.role]
      where.referrals = { some: { type: wantType, status: { in: ['PENDING', 'ACCEPTED', 'COMPLETED'] } } }
    }
    const list = await this.prisma.case.findMany({
      where,
      include: {
        resident: { select: { id: true, name: true } },
        lawyer: { select: { id: true, name: true } },
        referrals: { select: { type: true, status: true, isSafetyReferral: true, acceptedById: true, grants: { select: { userId: true, revokedAt: true } } } },
        _count: { select: { materials: true, tasks: true } },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    })
    return list.map((c) => this.maskIfNeeded(c, user))
  }

  // ---------- 详情 ----------
  async findOne(user: JwtUser, id: string) {
    const kase = await this.getCaseOr404(id)
    this.assertCanView(kase, user)
    // 附带实时期限风险评估（随时间推移动态变化）
    ;(kase as any).riskInfo = assessDeadlineRisk(kase)
    // 家暴案件律师接案前置协同状态（律师咨询不得孤立推进）
    ;(kase as any).dvCoordination = this.dvCoordinationState(kase)
    let out = this.maskIfNeeded(kase, user)
    out = this.filterSafetyPlan(out, user)
    return out
  }

  // 家暴案件协同状态：安全信息是否记录、是否已转介司法所/妇联/派出所、是否可由律师继续推进
  private dvCoordinationState(kase: any) {
    if (!kase.isDomesticViolence) return null
    const safetyTypes = ['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE']
    const referrals = (kase.referrals || []).filter((r: any) => r.isSafetyReferral && safetyTypes.includes(r.type))
    const accepted = referrals.filter((r: any) => ['ACCEPTED', 'COMPLETED'].includes(r.status))
    return {
      dvHandled: !!kase.dvHandled,
      safetyPlanRecorded: !!kase.safetyPlan,
      referralCount: referrals.length,
      acceptedCount: accepted.length,
      units: referrals.map((r: any) => ({
        type: r.type,
        toUnit: r.toUnit,
        status: r.status,
        acceptedById: r.acceptedById,
      })),
      // 律师可继续推进的条件：社区已完成安全处置，且至少一个协同单位已接收
      lawyerCanProceed: !!kase.dvHandled && accepted.length > 0,
    }
  }

  // 协同单位只能办理本单位转介；司法所/工作人员/管理员不受限
  private assertUnitOwnsReferral(ref: any, user: JwtUser) {
    if (['ADMIN', 'STAFF', 'JUDICIAL'].includes(user.role)) return
    const wantType = UNIT_ROLE_TO_REFERRAL[user.role]
    if (wantType && ref.type === wantType) return
    throw new ForbiddenException('该转介不属于本单位，无权办理')
  }

  // ---------- 资格初审 / 分流 ----------
  async review(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status)) {
      throw new BadRequestException('当前状态不可初审（已分流或已结案）')
    }
    const rules = computeSpecialRules(kase)
    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        category: dto.category,
        incomeQualified: dto.incomeQualified ?? null,
        reviewNotes: dto.reviewNotes || null,
        reviewedById: user.sub,
        reviewedAt: new Date(),
        status: dto.category === 'JUDICIAL_REFERRAL' ? 'REFERRED' : 'CLASSIFIED',
        priority: rules.priority as any,
        confidentiality: rules.confidentiality as any,
        ruleNotes: rules.reasons.join('；') || kase.ruleNotes,
      },
    })

    // 同一服务单：创建并纳入申请人、初审人员
    const order = await this.prisma.serviceOrder.upsert({
      where: { caseId: id },
      update: { status: 'IN_PROGRESS' },
      create: { orderNo: `FW-${kase.caseNo}`, caseId: id, status: 'IN_PROGRESS' },
    })
    const addParticipant = async (userId: string | null, duty: string) => {
      if (!userId) return
      await this.prisma.serviceOrderParticipant.upsert({
        where: { serviceOrderId_userId: { serviceOrderId: order.id, userId } },
        update: {},
        create: { serviceOrderId: order.id, userId, duty },
      })
    }
    await addParticipant(kase.residentId, '申请人')
    await addParticipant(user.sub, '初审与协同')

    // 特殊规则自动任务（避免与提交时已生成的同名任务重复）
    const existingTitles = new Set((await this.prisma.task.findMany({ where: { caseId: id }, select: { title: true } })).map((t) => t.title))
    for (const t of buildAutoTasks(kase)) {
      if (existingTitles.has(t.title)) continue
      await this.prisma.task.create({
        data: {
          caseId: id,
          type: t.type as any,
          title: t.title,
          description: t.description,
          assigneeRole: t.assigneeRole as any,
          createdById: user.sub,
          dueDate: t.dueDays ? new Date(Date.now() + t.dueDays * 86400000) : null,
        },
      })
    }

    // 司法所转介：自动生成转介单
    if (dto.category === 'JUDICIAL_REFERRAL') {
      await this.prisma.referral.create({
        data: {
          caseId: id,
          type: 'JUDICIAL',
          fromStreet: kase.street,
          toUnit: dto.referralTo || `${kase.street || '街道'}司法所`,
          reason: dto.reviewNotes || '初审分流至司法所',
          createdById: user.sub,
        },
      })
    }
    await this.event(id, user.sub, '资格初审', `分流为：${dto.category}；${dto.reviewNotes || ''}`)
    await this.refreshDeadlineRisk(id)
    return this.findOne(user, updated.id)
  }

  // ---------- 指派 / 接案 ----------
  async assign(user: JwtUser, id: string, lawyerId: string) {
    const kase = await this.getCaseOr404(id)
    if (kase.category !== 'LEGAL_AID') throw new BadRequestException('仅法律援助类案件可指派律师')
    if (kase.status === 'CLOSED') throw new BadRequestException('案件已结案')
    const lawyer = await this.prisma.user.findUnique({ where: { id: lawyerId } })
    if (!lawyer || lawyer.role !== 'LAWYER') throw new BadRequestException('律师不存在')
    await this.prisma.case.update({ where: { id }, data: { lawyerId, status: 'AWAITING_LAWYER' } })
    if (kase.serviceOrder) {
      await this.prisma.serviceOrderParticipant.upsert({
        where: { serviceOrderId_userId: { serviceOrderId: kase.serviceOrder.id, userId: lawyerId } },
        update: {},
        create: { serviceOrderId: kase.serviceOrder.id, userId: lawyerId, duty: '承办律师' },
      })
    }
    await this.prisma.task.create({
      data: { caseId: id, type: 'CONFLICT_CHECK', title: '接案前请完成利益冲突核查', assigneeId: lawyerId, assigneeRole: 'LAWYER', createdById: user.sub },
    })
    await this.event(id, user.sub, '指派律师', `指派值班律师 ${lawyer.name}${lawyer.onLeave ? '（该律师当前请假中，请注意）' : ''}`)
    return this.findOne(user, id)
  }

  async take(user: JwtUser, id: string) {
    const kase = await this.getCaseOr404(id)
    if (kase.category !== 'LEGAL_AID' || kase.lawyerId) throw new BadRequestException('案件不在可接案池中')
    await this.prisma.case.update({ where: { id }, data: { lawyerId: user.sub, status: 'AWAITING_LAWYER' } })
    if (kase.serviceOrder) {
      await this.prisma.serviceOrderParticipant.upsert({
        where: { serviceOrderId_userId: { serviceOrderId: kase.serviceOrder.id, userId: user.sub } },
        update: {},
        create: { serviceOrderId: kase.serviceOrder.id, userId: user.sub, duty: '承办律师' },
      })
    }
    await this.event(id, user.sub, '律师领案', `${user.name} 从案件池领取案件`)
    return this.findOne(user, id)
  }

  async conflictCheck(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (kase.lawyerId !== user.sub) throw new ForbiddenException('仅承办律师可核查')
    await this.prisma.conflictCheck.create({
      data: { caseId: id, lawyerId: user.sub, parties: dto.parties || kase.opposingParties || '', hasConflict: !!dto.hasConflict, note: dto.note || null },
    })
    await this.event(id, user.sub, '利益冲突核查', dto.hasConflict ? `存在利益冲突：${dto.note || ''}` : '无利益冲突')
    if (dto.hasConflict) {
      await this.prisma.case.update({ where: { id }, data: { lawyerId: null, status: 'CLASSIFIED' } })
      await this.prisma.task.create({
        data: { caseId: id, type: 'REASSIGNMENT', title: `律师 ${user.name} 因利益冲突回避，请重新指派`, assigneeRole: 'STAFF', createdById: user.sub },
      })
    }
    return this.findOne(user, id)
  }

  async accept(user: JwtUser, id: string) {
    const kase = await this.getCaseOr404(id)
    if (kase.lawyerId !== user.sub) throw new ForbiddenException('仅承办律师可接案')
    if (!['AWAITING_LAWYER', 'CLASSIFIED'].includes(kase.status)) throw new BadRequestException('当前状态不可接案')
    const hasCheck = await this.prisma.conflictCheck.findFirst({ where: { caseId: id, lawyerId: user.sub } })
    if (!hasCheck) throw new BadRequestException('请先完成利益冲突核查再接案')
    // 家暴案件：律师咨询不得孤立推进，须由社区完成安全处置并已有协同单位接收
    if (kase.isDomesticViolence) {
      const coord = this.dvCoordinationState(kase)
      if (!coord!.dvHandled) {
        throw new BadRequestException('该案存在家庭暴力风险：需先由社区工作人员记录安全联系人/临时住所/报警情况并发起协同转介，律师不得孤立接案')
      }
      if (coord!.acceptedCount === 0) {
        throw new BadRequestException('家暴协同转介（司法所/妇联/派出所）尚无单位接收，律师暂不可接案推进')
      }
    }
    await this.prisma.case.update({ where: { id }, data: { status: 'IN_SERVICE' } })
    await this.event(id, user.sub, '接受案件', kase.isDomesticViolence ? '家暴协同已建立，进入服务流程（律师与协同单位共同推进）' : '进入服务流程')
    return this.findOne(user, id)
  }

  async decline(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (kase.lawyerId !== user.sub) throw new ForbiddenException('仅承办律师可退案')
    await this.prisma.case.update({ where: { id }, data: { lawyerId: null, status: 'CLASSIFIED' } })
    await this.prisma.task.create({
      data: { caseId: id, type: 'REASSIGNMENT', title: `律师 ${user.name} 退回案件，请重新指派`, description: dto.reason, assigneeRole: 'STAFF', createdById: user.sub },
    })
    await this.event(id, user.sub, '退回案件', dto.reason || '')
    return this.findOne(user, id)
  }

  // ---------- 材料 ----------
  async addMaterial(user: JwtUser, id: string, meta: any, file?: Express.Multer.File) {
    const kase = await this.getCaseOr404(id)
    this.assertCanView(kase, user)
    const material = await this.prisma.material.create({
      data: {
        caseId: id,
        name: meta.name,
        kind: meta.kind || null,
        note: meta.note || null,
        status: 'RECEIVED',
        filePath: file ? file.filename : null,
        uploadedById: user.sub,
      },
    })
    await this.event(id, user.sub, '上传材料', meta.name)
    // 若案件处于待补正状态，居民补交后回到服务流程
    if (kase.status === 'MATERIAL_SUPPLEMENT') {
      await this.prisma.case.update({ where: { id }, data: { status: kase.lawyerId ? 'IN_SERVICE' : 'CLASSIFIED' } })
      await this.event(id, null, '材料已补交', '案件回到办理流程')
    }
    await this.refreshDeadlineRisk(id)
    return material
  }

  async requestMaterial(user: JwtUser, id: string, dto: any) {
    await this.getCaseOr404(id)
    await this.prisma.material.create({
      data: { caseId: id, name: dto.name, kind: dto.kind || null, note: dto.note || null, status: 'MISSING', uploadedById: user.sub },
    })
    const kase = await this.prisma.case.update({ where: { id }, data: { status: 'MATERIAL_SUPPLEMENT' } })
    await this.prisma.task.create({
      data: {
        caseId: id, type: 'MATERIAL_SUPPLEMENT', title: `补交材料：${dto.name}`, description: dto.note,
        assigneeRole: 'RESIDENT', assigneeId: kase.residentId, createdById: user.sub,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
    })
    await this.event(id, user.sub, '要求补正材料', dto.name)
    return this.findOne(user, id)
  }

  async updateMaterial(user: JwtUser, materialId: string, dto: any) {
    const m = await this.prisma.material.findUnique({ where: { id: materialId } })
    if (!m) throw new NotFoundException('材料不存在')
    const updated = await this.prisma.material.update({
      where: { id: materialId },
      data: { status: dto.status, note: dto.note ?? m.note },
    })
    await this.event(m.caseId, user.sub, '核验材料', `${m.name} → ${dto.status}${dto.note ? `：${dto.note}` : ''}`)
    await this.refreshDeadlineRisk(m.caseId)
    return updated
  }

  async getMaterialFile(user: JwtUser, materialId: string) {
    const m = await this.prisma.material.findUnique({ where: { id: materialId } })
    if (!m || !m.filePath) throw new NotFoundException('文件不存在')
    const kase = await this.getCaseOr404(m.caseId)
    this.assertCanView(kase, user)
    return m
  }

  // ---------- 材料线下代传（志愿者上门拍照/扫描/代交复印件） ----------
  async createProxy(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    // 工作人员、申请人本人、志愿者（可主动预约上门）均可发起
    if (!['STAFF', 'ADMIN', 'VOLUNTEER'].includes(user.role) && kase.residentId !== user.sub) {
      throw new ForbiddenException('无权发起材料代传')
    }
    if (kase.status === 'CLOSED') throw new BadRequestException('案件已结案，不能再发起代传')
    const method = ['PROXY_PHOTO', 'PROXY_SCAN', 'PROXY_COPY'].includes(dto.method) ? dto.method : 'PROXY_SCAN'
    await this.prisma.materialProxy.create({
      data: {
        caseId: id,
        materialName: dto.materialName,
        reason: dto.reason || (kase.isDisabled || kase.isElderlySupport ? '老人/残障居民无法线上上传' : null),
        method,
        involvesOriginal: !!dto.involvesOriginal,
        purpose: dto.purpose || null,
        requestedById: user.sub,
      },
    })
    // 志愿者代传任务（角色任务：任意志愿者可认领）
    await this.prisma.task.create({
      data: {
        caseId: id,
        type: 'MATERIAL_PROXY',
        title: `上门代传材料：${dto.materialName}`,
        description: `预约上门${method === 'PROXY_PHOTO' ? '拍照' : method === 'PROXY_COPY' ? '代交复印件' : '扫描'}${dto.involvesOriginal ? '（涉及原件，需登记取走/扫描/归还/居民确认）' : ''}`,
        assigneeRole: 'VOLUNTEER',
        createdById: user.sub,
        dueDate: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
    })
    if (user.role === 'VOLUNTEER' && kase.serviceOrder) {
      await this.prisma.serviceOrderParticipant.upsert({
        where: { serviceOrderId_userId: { serviceOrderId: kase.serviceOrder.id, userId: user.sub } },
        update: {},
        create: { serviceOrderId: kase.serviceOrder.id, userId: user.sub, duty: '上门代传材料' },
      })
    }
    await this.event(id, user.sub, '发起材料代传', `${dto.materialName}（${method === 'PROXY_PHOTO' ? '上门拍照' : method === 'PROXY_COPY' ? '代交复印件' : '上门扫描'}），待志愿者认领`)
    return this.findOne(user, id)
  }

  async listProxies(user: JwtUser) {
    const where: any = {}
    if (user.role === 'VOLUNTEER') {
      where.OR = [{ volunteerId: user.sub }, { status: 'REQUESTED' }]
    } else if (user.role === 'RESIDENT') {
      where.case = { residentId: user.sub }
    } else if (!['STAFF', 'ADMIN', 'JUDICIAL'].includes(user.role)) {
      throw new ForbiddenException('无权查看代传单')
    }
    return this.prisma.materialProxy.findMany({
      where,
      include: {
        case: { select: { id: true, caseNo: true, title: true, status: true, residentId: true, applicantName: true } },
        volunteer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    })
  }

  private async getProxyOr404(proxyId: string) {
    const proxy = await this.prisma.materialProxy.findUnique({ where: { id: proxyId }, include: { case: true } })
    if (!proxy) throw new NotFoundException('代传单不存在')
    return proxy
  }

  private assertProxyActor(proxy: any, user: JwtUser) {
    if (['STAFF', 'ADMIN'].includes(user.role)) return
    if (user.role === 'VOLUNTEER' && proxy.volunteerId === user.sub) return
    if (user.role === 'RESIDENT' && proxy.case.residentId === user.sub) return
    throw new ForbiddenException('仅认领志愿者、申请人或工作人员可操作')
  }

  async claimProxy(user: JwtUser, proxyId: string, dto: any) {
    if (user.role !== 'VOLUNTEER') throw new ForbiddenException('仅志愿者可认领代传单')
    const proxy = await this.getProxyOr404(proxyId)
    if (proxy.status !== 'REQUESTED') throw new BadRequestException('该代传单已被认领或已结束')
    await this.prisma.materialProxy.update({
      where: { id: proxyId },
      data: { volunteerId: user.sub, status: 'ASSIGNED', scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : proxy.scheduledAt },
    })
    // 认领对应志愿者角色任务
    const task = await this.prisma.task.findFirst({
      where: { caseId: proxy.caseId, type: 'MATERIAL_PROXY', assigneeRole: 'VOLUNTEER', assigneeId: null, status: 'OPEN' },
    })
    if (task) await this.prisma.task.update({ where: { id: task.id }, data: { assigneeId: user.sub, status: 'IN_PROGRESS' } })
    const order = await this.prisma.serviceOrder.findUnique({ where: { caseId: proxy.caseId } })
    if (order) {
      await this.prisma.serviceOrderParticipant.upsert({
        where: { serviceOrderId_userId: { serviceOrderId: order.id, userId: user.sub } },
        update: { duty: '上门代传材料' },
        create: { serviceOrderId: order.id, userId: user.sub, duty: '上门代传材料' },
      })
    }
    await this.event(proxy.caseId, user.sub, '志愿者认领代传', `认领材料：${proxy.materialName}${dto.scheduledAt ? `；预约上门 ${new Date(dto.scheduledAt).toLocaleString('zh-CN')}` : ''}`)
    return this.findOne(user, proxy.caseId)
  }

  async scheduleProxy(user: JwtUser, proxyId: string, dto: any) {
    const proxy = await this.getProxyOr404(proxyId)
    this.assertProxyActor(proxy, user)
    if (!['ASSIGNED', 'REQUESTED'].includes(proxy.status)) throw new BadRequestException('当前状态不可修改预约时间')
    if (!dto.scheduledAt) throw new BadRequestException('请选择预约上门时间')
    await this.prisma.materialProxy.update({ where: { id: proxyId }, data: { scheduledAt: new Date(dto.scheduledAt) } })
    await this.event(proxy.caseId, user.sub, '预约上门代传', `${proxy.materialName}：${new Date(dto.scheduledAt).toLocaleString('zh-CN')}`)
    return this.prisma.materialProxy.findUnique({ where: { id: proxyId } })
  }

  async markProxyStage(user: JwtUser, proxyId: string, stage: string, dto: any) {
    const proxy = await this.getProxyOr404(proxyId)
    // 取走/扫描/归还由认领志愿者或工作人员登记，申请人不可自行登记
    if (user.role === 'RESIDENT') throw new ForbiddenException('取走/扫描/归还由志愿者或工作人员登记')
    this.assertProxyActor(proxy, user)
    if (['CANCELLED', 'CONFIRMED'].includes(proxy.status)) throw new BadRequestException('代传单已结束')
    const now = new Date()
    const data: any = { note: dto.note !== undefined ? dto.note : proxy.note }

    if (stage === 'PICKED_UP') {
      if (!proxy.involvesOriginal) throw new BadRequestException('该代传不涉及原件，无需登记取走原件')
      if (!['ASSIGNED', 'PICKED_UP'].includes(proxy.status)) throw new BadRequestException('需先认领并预约')
      Object.assign(data, { status: 'PICKED_UP', pickedUpAt: proxy.pickedUpAt || now })
      await this.event(proxy.caseId, user.sub, '代传：取走原件', `${proxy.materialName}${dto.note ? `：${dto.note}` : ''}`)
    } else if (stage === 'SCANNED') {
      if (!['ASSIGNED', 'PICKED_UP', 'SCANNED'].includes(proxy.status)) throw new BadRequestException('当前状态不可登记扫描')
      // 涉及原件时须先登记取走，再拍照/扫描（取走→扫描→归还→确认）
      if (proxy.involvesOriginal && !proxy.pickedUpAt && proxy.status !== 'PICKED_UP') {
        throw new BadRequestException('涉及原件：请先登记「取走原件」再拍照/扫描')
      }
      const purpose = dto.purpose || proxy.purpose
      // 拍照/扫描完成：生成证据材料（律师端证据状态随之更新为“已提交待核验”）
      const material = await this.prisma.material.create({
        data: {
          caseId: proxy.caseId,
          name: proxy.materialName,
          kind: dto.kind || (proxy.method === 'PROXY_PHOTO' ? '照片' : proxy.method === 'PROXY_COPY' ? '复印件' : '扫描件'),
          note: `志愿者上门代传${proxy.involvesOriginal ? '（原件扫描）' : ''}${dto.note ? `：${dto.note}` : ''}`,
          status: 'RECEIVED',
          uploadedById: proxy.volunteerId || user.sub,
          method: proxy.method,
          proxyId: proxy.id,
          purpose: purpose || null,
        },
      })
      Object.assign(data, { status: 'SCANNED', scannedAt: proxy.scannedAt || now, purpose: purpose || proxy.purpose })
      await this.event(proxy.caseId, user.sub, '代传：拍照/扫描入卷', `${proxy.materialName} 已代为${proxy.method === 'PROXY_PHOTO' ? '拍照' : proxy.method === 'PROXY_COPY' ? '提交复印件' : '扫描'}，证据状态更新为「已提交待核验」（材料 ${material.id.slice(-6)}）`)
    } else if (stage === 'RETURNED') {
      if (!proxy.involvesOriginal) throw new BadRequestException('该代传不涉及原件，无需登记归还')
      if (!['PICKED_UP', 'SCANNED', 'RETURNED'].includes(proxy.status)) throw new BadRequestException('需先取走并扫描原件')
      if (!proxy.scannedAt && proxy.status !== 'SCANNED') throw new BadRequestException('请先完成拍照/扫描再归还原件')
      Object.assign(data, { status: 'RETURNED', returnedAt: proxy.returnedAt || now })
      await this.prisma.material.updateMany({ where: { proxyId: proxy.id }, data: { originalReturned: true } })
      await this.event(proxy.caseId, user.sub, '代传：原件归还', `${proxy.materialName} 已归还居民，待居民确认`)
    } else {
      throw new BadRequestException('未知代传环节')
    }
    await this.prisma.materialProxy.update({ where: { id: proxyId }, data })
    return this.findOne(user, proxy.caseId)
  }

  async confirmProxy(user: JwtUser, proxyId: string, dto: any) {
    const proxy = await this.getProxyOr404(proxyId)
    this.assertProxyActor(proxy, user)
    if (!proxy.scannedAt) throw new BadRequestException('材料尚未拍照/扫描入卷，不能确认')
    if (proxy.involvesOriginal && !proxy.returnedAt) {
      throw new BadRequestException('原件尚未归还居民，需先登记归还再由居民确认')
    }
    const purpose = dto.purpose || proxy.purpose || '用于本案件法律援助办理与举证'
    await this.prisma.materialProxy.update({
      where: { id: proxyId },
      data: { status: 'CONFIRMED', residentConfirmedAt: new Date(), completedAt: new Date(), purpose, destroyNoticeSentAt: new Date() },
    })
    // 代传完成：证据写入材料用途，并向居民端发送用途说明与销毁提醒
    await this.prisma.material.updateMany({
      where: { proxyId: proxy.id },
      data: { purpose, noticeSentAt: new Date() },
    })
    await this.prisma.task.updateMany({
      where: { caseId: proxy.caseId, type: 'MATERIAL_PROXY', status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'DONE', completedAt: new Date(), completedById: user.sub },
    })
    await this.event(
      proxy.caseId,
      user.sub,
      '代传完成并居民确认',
      `${proxy.materialName} 已完成代传；已向居民告知材料用途（${purpose}）与销毁/返还提醒：案件办结后可申请返还或销毁代传复印件/影像，请勿自行长期留存`,
    )
    return this.findOne(user, proxy.caseId)
  }

  async cancelProxy(user: JwtUser, proxyId: string, dto: any) {
    const proxy = await this.getProxyOr404(proxyId)
    if (!['STAFF', 'ADMIN'].includes(user.role) && proxy.requestedById !== user.sub) {
      throw new ForbiddenException('仅发起人或工作人员可取消')
    }
    await this.prisma.materialProxy.update({ where: { id: proxyId }, data: { status: 'CANCELLED' } })
    await this.prisma.task.updateMany({
      where: { caseId: proxy.caseId, type: 'MATERIAL_PROXY', status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED' },
    })
    await this.event(proxy.caseId, user.sub, '取消材料代传', `${proxy.materialName}${dto.reason ? `：${dto.reason}` : ''}`)
    return this.prisma.materialProxy.findUnique({ where: { id: proxyId } })
  }

  // ---------- 任务 ----------
  async addTask(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    this.assertCanView(kase, user)
    const task = await this.prisma.task.create({
      data: {
        caseId: id,
        type: dto.type || 'OTHER',
        title: dto.title,
        description: dto.description || null,
        assigneeId: dto.assigneeId || null,
        assigneeRole: dto.assigneeRole || null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: user.sub,
      },
    })
    await this.event(id, user.sub, '新增协同任务', dto.title)
    return task
  }

  async updateTask(user: JwtUser, taskId: string, dto: any) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('任务不存在')
    // 仅任务负责人、对应角色（角色任务）或管理员可变更任务状态
    const canUpdate =
      user.role === 'ADMIN' ||
      task.assigneeId === user.sub ||
      (!task.assigneeId && task.assigneeRole === user.role)
    if (!canUpdate) {
      throw new ForbiddenException('仅任务负责人、对应角色成员或管理员可更新任务状态')
    }
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: dto.status,
        completedAt: dto.status === 'DONE' ? new Date() : null,
        completedById: dto.status === 'DONE' ? user.sub : null, // 记录真实执行人
      },
    })
    await this.event(task.caseId, user.sub, '更新任务', `${task.title} → ${dto.status}`)
    return updated
  }

  async myTasks(user: JwtUser) {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { not: 'CANCELLED' },
        OR: [{ assigneeId: user.sub }, { assigneeId: null, assigneeRole: user.role as any }],
      },
      include: {
        case: { select: { id: true, caseNo: true, title: true, status: true, priority: true, confidentiality: true } },
        completedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: 200,
    })
    return tasks
  }

  // ---------- 服务单参与人 ----------
  async addParticipant(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (!kase.serviceOrder) throw new BadRequestException('服务单尚未生成（需先完成初审分流）')
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } })
    if (!target) throw new BadRequestException('用户不存在')
    await this.prisma.serviceOrderParticipant.upsert({
      where: { serviceOrderId_userId: { serviceOrderId: kase.serviceOrder.id, userId: dto.userId } },
      update: { duty: dto.duty || undefined },
      create: { serviceOrderId: kase.serviceOrder.id, userId: dto.userId, duty: dto.duty || null },
    })
    await this.event(id, user.sub, '加入服务单', `${target.name}（${target.role}）${dto.duty ? `：${dto.duty}` : ''}`)
    return this.findOne(user, id)
  }

  // ---------- 预约 ----------
  async addAppointment(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    await this.prisma.appointment.create({
      data: {
        caseId: id,
        lawyerId: dto.lawyerId || kase.lawyerId || null,
        scheduledAt: new Date(dto.scheduledAt),
        location: dto.location || null,
        note: dto.note || null,
      },
    })
    await this.event(id, user.sub, '新增预约', `${dto.scheduledAt} ${dto.location || ''}`)
    return this.findOne(user, id)
  }

  async updateAppointment(user: JwtUser, apptId: string, dto: any) {
    const appt = await this.prisma.appointment.findUnique({ where: { id: apptId } })
    if (!appt) throw new NotFoundException('预约不存在')
    const updated = await this.prisma.appointment.update({ where: { id: apptId }, data: { status: dto.status } })
    await this.event(appt.caseId, user.sub, '更新预约', `预约状态 → ${dto.status}`)
    return updated
  }

  // ---------- 转介 ----------
  async addReferral(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    await this.prisma.referral.create({
      data: {
        caseId: id,
        type: dto.type || 'OTHER_ORG',
        fromStreet: kase.street,
        toStreet: dto.toStreet || null,
        toUnit: dto.toUnit,
        reason: dto.reason || null,
        isSafetyReferral: !!dto.isSafetyReferral && kase.isDomesticViolence,
        createdById: user.sub,
      },
    })
    await this.prisma.case.update({ where: { id }, data: { status: 'REFERRED' } })
    await this.event(id, user.sub, '发起转介', `转介至 ${dto.toUnit}${dto.toStreet ? `（${dto.toStreet}）` : ''}`)
    return this.findOne(user, id)
  }

  // ---------- 家暴安全处置 ----------
  // 记录安全联系人、临时住所、报警情况（社区工作人员）
  async saveSafetyPlan(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (!kase.isDomesticViolence) throw new BadRequestException('仅家庭暴力风险案件需要记录安全处置信息')
    const policeReported = !!dto.policeReported
    const data = {
      emergencyContactName: dto.emergencyContactName || null,
      emergencyContactPhone: dto.emergencyContactPhone || null,
      emergencyContactRel: dto.emergencyContactRel || null,
      shelterName: dto.shelterName || null,
      shelterAddress: dto.shelterAddress || null,
      shelterArranged: !!dto.shelterArranged,
      policeReported,
      policeReportNo: policeReported ? dto.policeReportNo || null : null,
      policeReportAt: policeReported && dto.policeReportAt ? new Date(dto.policeReportAt) : null,
      policeNote: dto.policeNote || null,
      riskLevel: dto.riskLevel || null,
      notes: dto.notes || null,
      recordedById: user.sub,
    }
    await this.prisma.safetyPlan.upsert({ where: { caseId: id }, update: data, create: { caseId: id, ...data } })
    await this.event(
      id,
      user.sub,
      '记录家暴安全信息',
      `安全联系人${data.emergencyContactName ? '：' + data.emergencyContactName : ''}；临时住所：${data.shelterArranged ? '已安排' : '暂未安排'}；报警情况：${policeReported ? '已报警' : '未报警'}`,
    )
    // 完成安全处置待办
    await this.markSafetyTaskDone(id, user.sub)
    return this.findOne(user, id)
  }

  private async markSafetyTaskDone(caseId: string, userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { caseId, type: 'COORDINATION', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    })
    for (const t of tasks) {
      if (t.title.includes('家暴安全信息')) {
        await this.prisma.task.update({
          where: { id: t.id },
          data: { status: 'DONE', completedAt: new Date(), completedById: userId },
        })
      }
    }
  }

  // 发起家暴协同转介：案件转给司法所、妇联或派出所协同处理（可多选，幂等）
  async safetyReferrals(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (!kase.isDomesticViolence) throw new BadRequestException('仅家庭暴力风险案件可发起协同转介')
    const units: string[] = Array.isArray(dto.units) && dto.units.length ? dto.units : []
    const valid = units.filter((u) => ['JUDICIAL', 'WOMEN_FEDERATION', 'POLICE'].includes(u))
    if (!valid.length) throw new BadRequestException('请至少选择一个协同单位（司法所/妇联/派出所）')

    // 安全信息至少记录其一，避免在没有任何保护信息时把案件孤立转走
    const sp = await this.prisma.safetyPlan.findUnique({ where: { caseId: id } })
    const hasSafety =
      !!sp &&
      (!!sp.emergencyContactPhone || sp.shelterArranged || sp.policeReported || !!sp.notes)
    if (!hasSafety) {
      throw new BadRequestException('请先记录安全联系人、临时住所或报警情况，再发起协同转介')
    }

    const existing = await this.prisma.referral.findMany({
      where: { caseId: id, isSafetyReferral: true, type: { in: valid } },
    })
    const existingTypes = new Set(existing.map((r) => r.type))
    const created: string[] = []
    for (const type of valid) {
      if (existingTypes.has(type)) continue
      const unitUsers = await this.prisma.user.findMany({
        where: { role: type as any },
        select: { id: true, organization: true },
        orderBy: { createdAt: 'asc' },
      })
      const toUnit =
        unitUsers[0]?.organization ||
        (type === 'JUDICIAL' ? `${kase.street || '街道'}司法所` : type === 'WOMEN_FEDERATION' ? '街道妇女联合会' : '辖区派出所')
      const ref = await this.prisma.referral.create({
        data: {
          caseId: id,
          type,
          fromStreet: kase.street,
          toUnit,
          isSafetyReferral: true,
          reason: dto.reason || '家暴风险案件，需协同保护申请人人身安全，律师咨询与本单位协同推进',
          createdById: user.sub,
        },
      })
      // 默认安排接收后 7 天回访
      await this.prisma.referralFollowUp.create({
        data: { referralId: ref.id, scheduledAt: new Date(Date.now() + DEFAULT_FOLLOW_UP_DAYS * 86400000) },
      })
      created.push(SAFETY_UNIT_LABELS[type])

      // 纳入服务单协同（同单位首位成员），体现多角色同一服务单
      if (kase.serviceOrder && unitUsers[0]) {
        await this.prisma.serviceOrderParticipant.upsert({
          where: { serviceOrderId_userId: { serviceOrderId: kase.serviceOrder.id, userId: unitUsers[0].id } },
          update: {},
          create: { serviceOrderId: kase.serviceOrder.id, userId: unitUsers[0].id, duty: `${SAFETY_UNIT_LABELS[type]}协同` },
        })
      }
    }

    // 安全处置完成：安全信息已记录 + 至少一个协同单位转介
    await this.prisma.case.update({ where: { id }, data: { dvHandled: true } })
    await this.event(
      id,
      user.sub,
      '发起家暴协同转介',
      `转介至 ${created.length ? created.join('、') : '（已存在）'}协同处理；当事人联系方式与住址仅对授权人员可见，已安排 ${DEFAULT_FOLLOW_UP_DAYS} 天后回访`,
    )
    return this.findOne(user, id)
  }

  // 协同单位接收转介：登记接收人（成为授权人员），保留转介节点
  async updateReferral(user: JwtUser, refId: string, dto: any) {
    const ref = await this.prisma.referral.findUnique({ where: { id: refId }, include: { case: true } })
    if (!ref) throw new NotFoundException('转介单不存在')
    // 家暴协同转介只能由对应协同单位接收/退回
    if (ref.isSafetyReferral) {
      const wantRole = Object.entries(UNIT_ROLE_TO_REFERRAL).find(([, t]) => t === ref.type)?.[0]
      if (wantRole && user.role !== wantRole && user.role !== 'ADMIN') {
        throw new ForbiddenException('该协同转介由对应单位的授权人员接收')
      }
    } else if (['WOMEN_FEDERATION', 'POLICE'].includes(user.role)) {
      throw new ForbiddenException('妇联/派出所仅可办理本单位家暴协同转介')
    }
    const updated = await this.prisma.referral.update({
      where: { id: refId },
      data: {
        status: dto.status,
        handledAt: new Date(),
        acceptedById: dto.status === 'ACCEPTED' ? user.sub : ref.acceptedById,
      },
    })
    // 接收即对接收人授权查看当事人联系方式与住址
    if (dto.status === 'ACCEPTED') {
      await this.prisma.referralAuthorization.upsert({
        where: { referralId_userId: { referralId: refId, userId: user.sub } },
        update: { revokedAt: null },
        create: { referralId: refId, userId: user.sub, grantedById: ref.createdById, scope: 'CONTACT_ADDRESS' },
      })
      const order = await this.prisma.serviceOrder.findUnique({ where: { caseId: ref.caseId } })
      if (order) {
        await this.prisma.serviceOrderParticipant.upsert({
          where: { serviceOrderId_userId: { serviceOrderId: order.id, userId: user.sub } },
          update: {},
          create: { serviceOrderId: order.id, userId: user.sub, duty: `${SAFETY_UNIT_LABELS[ref.type] || '协同单位'}接收人` },
        })
      }
    }
    if (dto.status === 'ACCEPTED' && ref.type === 'CROSS_STREET' && ref.toStreet) {
      await this.prisma.case.update({ where: { id: ref.caseId }, data: { street: ref.toStreet, source: 'CROSS_STREET' } })
    }
    await this.event(ref.caseId, user.sub, '转介处理', `${ref.toUnit}：${dto.status}${dto.status === 'ACCEPTED' ? '（接收人已获授权查看联系方式与住址）' : ''}`)
    return updated
  }

  // 工作人员为某转介追加授权人员（协同单位内可查看联系方式/住址的成员）
  async grantReferralAccess(user: JwtUser, refId: string, dto: any) {
    const ref = await this.prisma.referral.findUnique({ where: { id: refId }, include: { case: true } })
    if (!ref) throw new NotFoundException('转介单不存在')
    if (!ref.isSafetyReferral) throw new BadRequestException('仅家暴协同转介需要授权管理')
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } })
    if (!target) throw new BadRequestException('用户不存在')
    const wantRole = Object.entries(UNIT_ROLE_TO_REFERRAL).find(([, t]) => t === ref.type)?.[0]
    if (wantRole && target.role !== wantRole) {
      throw new BadRequestException(`只能授权给${SAFETY_UNIT_LABELS[ref.type]}的工作人员`)
    }
    const grant = await this.prisma.referralAuthorization.upsert({
      where: { referralId_userId: { referralId: refId, userId: dto.userId } },
      update: { revokedAt: dto.revoke ? new Date() : null },
      create: { referralId: refId, userId: dto.userId, grantedById: user.sub, scope: 'CONTACT_ADDRESS' },
    })
    await this.event(ref.caseId, user.sub, dto.revoke ? '撤销查看授权' : '授予查看授权', `${SAFETY_UNIT_LABELS[ref.type]}：${target.name}（联系方式与住址）`)
    return grant
  }

  // 安排/登记转介回访（保留后续回访时间）
  async scheduleReferralFollowUp(user: JwtUser, refId: string, dto: any) {
    const ref = await this.prisma.referral.findUnique({ where: { id: refId } })
    if (!ref) throw new NotFoundException('转介单不存在')
    this.assertUnitOwnsReferral(ref, user)
    const follow = await this.prisma.referralFollowUp.create({
      data: {
        referralId: refId,
        scheduledAt: new Date(dto.scheduledAt),
        result: dto.result || null,
        doneAt: dto.result ? new Date() : null,
        doneById: dto.result ? user.sub : null,
      },
    })
    await this.event(ref.caseId, user.sub, '转介回访', `${ref.toUnit}：计划 ${new Date(dto.scheduledAt).toLocaleString('zh-CN')}${dto.result ? `；结果：${dto.result}` : ''}`)
    return follow
  }

  async completeReferralFollowUp(user: JwtUser, followId: string, dto: any) {
    const follow = await this.prisma.referralFollowUp.findUnique({ where: { id: followId }, include: { referral: true } })
    if (!follow) throw new NotFoundException('回访记录不存在')
    this.assertUnitOwnsReferral(follow.referral, user)
    const updated = await this.prisma.referralFollowUp.update({
      where: { id: followId },
      data: { result: dto.result, doneAt: new Date(), doneById: user.sub },
    })
    await this.event(follow.referral.caseId, user.sub, '转介回访完成', `${follow.referral.toUnit}：${dto.result}`)
    return updated
  }

  async listReferrals(user: JwtUser) {
    const rows = await this.prisma.referral.findMany({
      include: {
        case: { select: { id: true, caseNo: true, title: true, type: true, status: true, priority: true, confidentiality: true, applicantName: true, isDomesticViolence: true } },
        createdBy: { select: { id: true, name: true } },
        acceptedBy: { select: { id: true, name: true, role: true, organization: true } },
        grants: { include: { user: { select: { id: true, name: true, role: true, organization: true } } } },
        followUps: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    // 妇联/派出所仅能看到转介给本单位的单据；司法所/工作人员/管理员看全部
    if (user.role === 'WOMEN_FEDERATION' || user.role === 'POLICE') {
      const wantType = UNIT_ROLE_TO_REFERRAL[user.role]
      return rows.filter((r) => r.type === wantType)
    }
    return rows
  }

  // ---------- 结案归档 ----------
  async close(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (kase.status === 'CLOSED') throw new BadRequestException('案件已结案')
    const isStaff = ['STAFF', 'ADMIN'].includes(user.role)
    const isLawyer = user.role === 'LAWYER' && kase.lawyerId === user.sub
    if (!isStaff && !isLawyer) throw new ForbiddenException('仅社区工作人员或承办律师可结案')

    // 前置条件一：必须完成规定服务阶段
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(kase.status)) {
      throw new BadRequestException('案件尚未完成资格初审分流，不能结案')
    }
    if (kase.category === 'LEGAL_AID') {
      if (kase.status !== 'IN_SERVICE') {
        throw new BadRequestException('法律援助案件须由律师接案并处于服务进行中，方可结案')
      }
    } else if (!['CLASSIFIED', 'REFERRED', 'FOLLOW_UP'].includes(kase.status)) {
      throw new BadRequestException('当前状态不可结案：需先完成分流/转介等服务阶段')
    }

    // 前置条件二：归档必填资料齐全
    const missing: string[] = []
    if (!dto.consultationOpinion || !String(dto.consultationOpinion).trim()) missing.push('咨询意见')
    if (!dto.materialCorrections || !String(dto.materialCorrections).trim()) missing.push('材料补正记录')
    if (!dto.referralDestination || !String(dto.referralDestination).trim()) missing.push('转介去向')
    const hours = parseStrictHours(dto.lawyerHours)
    if (hours === null) missing.push('律师工时（须为不小于 0 的明确数值）')
    if (missing.length) {
      throw new BadRequestException(`归档资料不全，缺少：${missing.join('、')}`)
    }

    await this.prisma.archive.upsert({
      where: { caseId: id },
      update: {},
      create: {
        caseId: id,
        consultationOpinion: dto.consultationOpinion,
        materialCorrections: dto.materialCorrections,
        referralDestination: dto.referralDestination,
        lawyerHours: hours!,
        followUpResult: dto.followUpResult || null,
        closedById: user.sub,
      },
    })
    await this.prisma.case.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() } })
    if (kase.serviceOrder) {
      await this.prisma.serviceOrder.update({ where: { id: kase.serviceOrder.id }, data: { status: 'DONE' } })
    }
    await this.prisma.task.updateMany({ where: { caseId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { status: 'CANCELLED' } })
    await this.event(id, user.sub, '结案归档', '咨询意见、工时与转介去向已入档')
    return this.findOne(user, id)
  }

  async satisfaction(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (kase.residentId !== user.sub) throw new ForbiddenException('仅申请人本人可评价')
    if (kase.status !== 'CLOSED') throw new BadRequestException('案件结案后才能评价')
    const score = Number(dto.score)
    if (!score || score < 1 || score > 5) throw new BadRequestException('满意度须为 1-5 分')
    await this.prisma.archive.update({
      where: { caseId: id },
      data: { satisfaction: score, satisfactionNote: dto.note || null },
    })
    await this.event(id, user.sub, '居民评价', `满意度 ${score} 分`)
    return this.findOne(user, id)
  }

  async followUp(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    if (!kase.archive && kase.status !== 'CLOSED') {
      // 服务进行中也可回访，不必已归档（上门代传后的关怀回访等）
    }
    const outcome = ['RESOLVED', 'ONGOING', 'NEED_REFERRAL'].includes(dto.outcome) ? dto.outcome : null
    await this.prisma.archive.updateMany({ where: { caseId: id }, data: { followUpResult: dto.result } })
    // 回访结果更新案件状态
    const data: any = {
      lastFollowUpAt: new Date(),
      lastFollowUpResult: dto.result,
      lastFollowUpOutcome: outcome,
    }
    if (outcome === 'NEED_REFERRAL') {
      data.status = 'REFERRED'
    } else if (outcome && kase.status !== 'CLOSED') {
      // 已解决 / 继续跟进：在办案件进入回访跟进中；已结案的保留结案状态，仅记录回访
      data.status = 'FOLLOW_UP'
    }
    await this.prisma.case.update({ where: { id }, data })
    const outcomeLabel: Record<string, string> = { RESOLVED: '问题已解决', ONGOING: '继续跟进', NEED_REFERRAL: '需再次转介' }
    await this.event(id, user.sub, '回访登记', `${dto.result}${outcome ? `（回访结论：${outcomeLabel[outcome]}，案件状态已更新）` : ''}`)
    return this.findOne(user, id)
  }

  // ---------- 期限风险管理 ----------

  // 工作人员首页：期限风险预警列表（实时评估，避免紧急案件被普通咨询淹没）
  async deadlineRisks(user: JwtUser) {
    const openCases = await this.prisma.case.findMany({
      where: { status: { notIn: ['CLOSED', 'REFERRED', 'FOLLOW_UP'] } },
      include: {
        materials: { select: { status: true } },
        keyDates: true,
        reminders: { orderBy: { createdAt: 'desc' }, take: 1, include: { remindedBy: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const items = openCases
      .map((c) => {
        const risk = assessDeadlineRisk(c)
        const verified = c.materials.filter((m) => m.status === 'VERIFIED').length
        return {
          id: c.id,
          caseNo: c.caseNo,
          title: c.title,
          type: c.type,
          status: c.status,
          priority: c.priority,
          applicantName: c.confidentiality === 'NORMAL' ? c.applicantName : maskName(c.applicantName),
          risk,
          evidence: { verified, total: c.materials.length },
          residentIntent: c.residentIntent,
          lastReminder: c.reminders[0] || null,
        }
      })
      .filter((i) => ['MEDIUM', 'HIGH', 'EXPIRED'].includes(i.risk.level))
      .sort((a, b) => (a.risk.daysLeft ?? 99999) - (b.risk.daysLeft ?? 99999))
    return items
  }

  // 生成标准材料清单（登记为待补材料并通知居民）
  async generateChecklist(user: JwtUser, id: string) {
    const kase = await this.getCaseOr404(id)
    if (kase.status === 'CLOSED') throw new BadRequestException('案件已结案')
    const list = MATERIAL_CHECKLISTS[kase.type]
    if (!list) throw new BadRequestException('该案件类型暂无标准材料清单')
    const existing = new Set(kase.materials.map((m) => m.name))
    const toCreate = list.filter((name) => !existing.has(name))
    for (const name of toCreate) {
      await this.prisma.material.create({
        data: { caseId: id, name, status: 'MISSING', note: '按标准清单待补', uploadedById: user.sub },
      })
    }
    if (toCreate.length && kase.residentId) {
      await this.prisma.task.create({
        data: {
          caseId: id,
          type: 'MATERIAL_SUPPLEMENT',
          title: `请按材料清单准备 ${toCreate.length} 项材料（期限风险案件）`,
          assigneeId: kase.residentId,
          assigneeRole: 'RESIDENT',
          createdById: user.sub,
        },
      })
    }
    await this.event(id, user.sub, '生成材料清单', `新增 ${toCreate.length} 项待补材料`)
    await this.refreshDeadlineRisk(id)
    return this.findOne(user, id)
  }

  // 记录居民是否愿意立即启动程序
  async setResidentIntent(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    const labels: Record<string, string> = { WILLING: '愿意立即启动程序', NOT_YET: '暂缓考虑', DECLINED: '放弃申请' }
    await this.prisma.case.update({
      where: { id },
      data: { residentIntent: dto.intent, residentIntentNote: dto.note || null },
    })
    await this.event(id, user.sub, '居民意愿登记', `${labels[dto.intent] || dto.intent}${dto.note ? `：${dto.note}` : ''}`)
    if (dto.intent === 'WILLING' && kase.category === 'LEGAL_AID' && !kase.lawyerId) {
      await this.prisma.task.create({
        data: {
          caseId: id,
          type: 'OTHER',
          title: '居民愿意立即启动程序，请优先指派值班律师',
          assigneeRole: 'STAFF',
          createdById: user.sub,
        },
      })
    }
    return this.findOne(user, id)
  }

  // 登记期限提醒并评估及时性（用于服务质量复盘）
  async addReminder(user: JwtUser, id: string, dto: any) {
    const kase = await this.getCaseOr404(id)
    const risk = assessDeadlineRisk(kase)
    const daysLeft = risk.daysLeft
    const timeliness = daysLeft === null ? 'TIMELY' : daysLeft > 7 ? 'TIMELY' : daysLeft >= 0 ? 'LATE' : 'MISSED'
    const reminder = await this.prisma.deadlineReminder.create({
      data: {
        caseId: id,
        channel: dto.channel,
        note: dto.note || null,
        timeliness,
        daysLeftAtReminder: daysLeft,
        remindedById: user.sub,
      },
    })
    const channelLabels: Record<string, string> = { PHONE: '电话', VISIT: '上门', MESSAGE: '平台消息', OTHER: '其他' }
    const timeLabels: Record<string, string> = { TIMELY: '提醒及时', LATE: '临近才提醒', MISSED: '逾期才提醒' }
    await this.event(
      id,
      user.sub,
      `期限提醒（${channelLabels[dto.channel] || dto.channel}）`,
      `${dto.note || '已提醒居民关键期限'}；距期限 ${daysLeft === null ? '未知' : daysLeft + ' 天'}（${timeLabels[timeliness]}）`,
    )
    return reminder
  }
}
