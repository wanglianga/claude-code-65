import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { JwtUser } from '../common'
import { buildAutoTasks, computeSpecialRules, maskName, maskPhone } from './rules'

const CASE_INCLUDE = {
  resident: { select: { id: true, name: true, phone: true } },
  reviewedBy: { select: { id: true, name: true } },
  lawyer: { select: { id: true, name: true, organization: true, onLeave: true } },
  materials: { include: { uploadedBy: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
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
  referrals: { include: { createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
  conflictChecks: { include: { lawyer: { select: { id: true, name: true } } }, orderBy: { checkedAt: 'desc' as const } },
  events: { include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' as const } },
  archive: true,
  serviceOrder: {
    include: { participants: { include: { user: { select: { id: true, name: true, role: true, organization: true } } } } },
  },
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

  private async getCaseOr404(id: string) {
    const kase = await this.prisma.case.findUnique({ where: { id }, include: CASE_INCLUDE })
    if (!kase) throw new NotFoundException('案件不存在')
    return kase
  }

  private assertCanView(kase: any, user: JwtUser) {
    if (['ADMIN', 'STAFF', 'JUDICIAL'].includes(user.role)) return
    if (user.role === 'RESIDENT') {
      if (kase.residentId !== user.sub) throw new ForbiddenException('只能查看自己的案件')
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

  private maskIfNeeded(kase: any, user: JwtUser) {
    if (!kase || kase.confidentiality === 'NORMAL') return kase
    if (['ADMIN', 'STAFF', 'JUDICIAL'].includes(user.role)) return kase
    if (kase.residentId === user.sub) return kase
    if (user.role === 'LAWYER' && kase.lawyerId === user.sub) return kase
    // 未承办人员：隐藏申请人身份
    kase.applicantName = maskName(kase.applicantName)
    kase.applicantPhone = maskPhone(kase.applicantPhone)
    if (kase.resident) {
      kase.resident.name = maskName(kase.resident.name)
      kase.resident.phone = maskPhone(kase.resident.phone)
    }
    return kase
  }

  // ---------- 提交 ----------
  async create(user: JwtUser, dto: any) {
    const isStaffIntake = ['STAFF', 'ADMIN'].includes(user.role)
    const source = isStaffIntake ? (dto.source || 'OFFLINE_PAPER') : 'ONLINE'
    if (user.role !== 'RESIDENT' && !isStaffIntake) throw new ForbiddenException('当前角色不能提交咨询')

    const rules = computeSpecialRules(dto)
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
        priority: rules.priority as any,
        confidentiality: rules.confidentiality as any,
        ruleNotes: rules.reasons.join('；') || null,
        applicantName: isStaffIntake ? dto.applicantName : user.name,
        applicantPhone: isStaffIntake ? dto.applicantPhone || null : dbUser?.phone || null,
        residentId: isStaffIntake ? null : user.sub,
        familyIncome: dto.familyIncome ?? null,
        isDisabled: !!dto.isDisabled,
        involvesMinor: !!dto.involvesMinor,
        isWageArrearsGroup: !!dto.isWageArrearsGroup,
        isDomesticViolence: !!dto.isDomesticViolence,
        isElderlySupport: !!dto.isElderlySupport,
        isMinorRights: !!dto.isMinorRights,
        opponentSued: !!dto.opponentSued,
        opposingParties: dto.opposingParties || null,
        statuteOfLimitations: dto.statuteOfLimitations ? new Date(dto.statuteOfLimitations) : null,
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
    if (rules.reasons.length) {
      await this.event(kase.id, null, '命中特殊规则', rules.reasons.join('；'))
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
    }
    const list = await this.prisma.case.findMany({
      where,
      include: {
        resident: { select: { id: true, name: true } },
        lawyer: { select: { id: true, name: true } },
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
    return this.maskIfNeeded(kase, user)
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

    // 特殊规则自动任务
    for (const t of buildAutoTasks(kase)) {
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
    await this.prisma.case.update({ where: { id }, data: { status: 'IN_SERVICE' } })
    await this.event(id, user.sub, '接受案件', '进入服务流程')
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
    return updated
  }

  async getMaterialFile(user: JwtUser, materialId: string) {
    const m = await this.prisma.material.findUnique({ where: { id: materialId } })
    if (!m || !m.filePath) throw new NotFoundException('文件不存在')
    const kase = await this.getCaseOr404(m.caseId)
    this.assertCanView(kase, user)
    return m
  }

  // ---------- 任务 ----------
  async addTask(user: JwtUser, id: string, dto: any) {
    await this.getCaseOr404(id)
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
        createdById: user.sub,
      },
    })
    await this.prisma.case.update({ where: { id }, data: { status: 'REFERRED' } })
    await this.event(id, user.sub, '发起转介', `转介至 ${dto.toUnit}${dto.toStreet ? `（${dto.toStreet}）` : ''}`)
    return this.findOne(user, id)
  }

  async updateReferral(user: JwtUser, refId: string, dto: any) {
    const ref = await this.prisma.referral.findUnique({ where: { id: refId }, include: { case: true } })
    if (!ref) throw new NotFoundException('转介单不存在')
    const updated = await this.prisma.referral.update({
      where: { id: refId },
      data: { status: dto.status, handledAt: new Date() },
    })
    if (dto.status === 'ACCEPTED' && ref.type === 'CROSS_STREET' && ref.toStreet) {
      await this.prisma.case.update({ where: { id: ref.caseId }, data: { street: ref.toStreet, source: 'CROSS_STREET' } })
    }
    await this.event(ref.caseId, user.sub, '转介处理', `${ref.toUnit}：${dto.status}`)
    return updated
  }

  async listReferrals(user: JwtUser) {
    return this.prisma.referral.findMany({
      include: {
        case: { select: { id: true, caseNo: true, title: true, type: true, status: true, priority: true, confidentiality: true, applicantName: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
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
    } else if (!['CLASSIFIED', 'REFERRED'].includes(kase.status)) {
      throw new BadRequestException('当前状态不可结案：需先完成分流/转介等服务阶段')
    }

    // 前置条件二：归档必填资料齐全
    const missing: string[] = []
    if (!dto.consultationOpinion || !String(dto.consultationOpinion).trim()) missing.push('咨询意见')
    if (!dto.materialCorrections || !String(dto.materialCorrections).trim()) missing.push('材料补正记录')
    if (!dto.referralDestination || !String(dto.referralDestination).trim()) missing.push('转介去向')
    if (dto.lawyerHours === null || dto.lawyerHours === undefined || isNaN(Number(dto.lawyerHours))) missing.push('律师工时')
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
        lawyerHours: Number(dto.lawyerHours),
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
    if (!kase.archive) throw new BadRequestException('案件尚未归档')
    await this.prisma.archive.update({ where: { caseId: id }, data: { followUpResult: dto.result } })
    await this.event(id, user.sub, '回访登记', dto.result)
    return this.findOne(user, id)
  }
}
