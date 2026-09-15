// 种子数据：演示账号 + 各状态示例案件。幂等（按唯一键 upsert / 存在即跳过）。
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

const pwd = (s) => bcrypt.hashSync(s, 10)

async function upsertUser(username, data) {
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, ...data },
  })
}

async function ensureCase(caseNo, build) {
  const exists = await prisma.case.findUnique({ where: { caseNo } })
  if (exists) return exists
  return build()
}

async function main() {
  console.log('Seeding users...')
  const admin = await upsertUser('admin', { password: pwd('admin123'), name: '平台管理员', role: 'ADMIN', organization: '区法律援助中心', street: '朝阳街道' })
  const staff = await upsertUser('staff01', { password: pwd('staff123'), name: '王秀英', role: 'STAFF', organization: '阳光社区居委会', street: '朝阳街道', phone: '13800000001' })
  const staff2 = await upsertUser('staff02', { password: pwd('staff123'), name: '李建国', role: 'STAFF', organization: '滨河社区居委会', street: '滨河街道', phone: '13800000002' })
  const lawyer1 = await upsertUser('lawyer01', { password: pwd('lawyer123'), name: '陈明远', role: 'LAWYER', organization: '中正律师事务所', phone: '13800000011' })
  const lawyer2 = await upsertUser('lawyer02', { password: pwd('lawyer123'), name: '赵婉婷', role: 'LAWYER', organization: '弘一律师事务所', phone: '13800000012' })
  const judicial = await upsertUser('judicial01', { password: pwd('judicial123'), name: '孙立人', role: 'JUDICIAL', organization: '朝阳街道司法所', street: '朝阳街道', phone: '13800000021' })
  const women = await upsertUser('women01', { password: pwd('women123'), name: '周文娟', role: 'WOMEN_FEDERATION', organization: '朝阳街道妇女联合会', street: '朝阳街道', phone: '13800000041' })
  const police = await upsertUser('police01', { password: pwd('police123'), name: '陈伟强', role: 'POLICE', organization: '朝阳路派出所', street: '朝阳街道', phone: '13800000051' })
  const volunteer = await upsertUser('volunteer01', { password: pwd('volunteer123'), name: '周晓燕', role: 'VOLUNTEER', organization: '朝阳街道志愿服务队', street: '朝阳街道', phone: '13800000031' })
  const resident1 = await upsertUser('resident01', { password: pwd('resident123'), name: '张大山', role: 'RESIDENT', phone: '13911110001', street: '朝阳街道' })
  const resident2 = await upsertUser('resident02', { password: pwd('resident123'), name: '刘桂芳', role: 'RESIDENT', phone: '13911110002', street: '朝阳街道' })

  console.log('Seeding demo cases...')
  const now = Date.now()
  const day = 86400000

  // 1) 欠薪群体劳动纠纷：服务进行中（律师已接案）
  const c1 = await ensureCase('LA20260901-0001', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260901-0001',
        title: '某餐饮企业拖欠12名员工工资',
        type: 'LABOR_DISPUTE',
        description: '申请人等12名员工自2026年5月起被拖欠工资共计约18.6万元，多次协商无果。企业近期有搬迁迹象，担心转移财产。',
        source: 'ONLINE',
        status: 'IN_SERVICE',
        urgency: 'HIGH',
        priority: 'URGENT',
        category: 'LEGAL_AID',
        applicantName: '张大山',
        applicantPhone: '13911110001',
        residentId: resident1.id,
        familyIncome: 3200,
        isWageArrearsGroup: true,
        opposingParties: '味美餐饮管理有限公司（法定代表人：吴某）',
        statuteOfLimitations: new Date(now + 20 * day),
        incidentDate: new Date(now - 340 * day),
        street: '朝阳街道',
        reviewedById: staff.id,
        reviewedAt: new Date(now - 10 * day),
        reviewNotes: '属欠薪群体案件，经济困难初审通过，建议法律援助并联动劳动监察。',
        incomeQualified: true,
        lawyerId: lawyer1.id,
        ruleNotes: '欠薪群体：高优先级，联动劳动监察；诉讼时效临近：升级为紧急',
        keyDates: { create: [
          { label: '劳动仲裁时效届满', date: new Date(now + 20 * day), kind: 'statute' },
          { label: '劳动监察大队联合约谈', date: new Date(now + 5 * day), kind: 'other' },
        ] },
      },
    })
    const order = await prisma.serviceOrder.create({ data: { orderNo: 'FW-LA20260901-0001', caseId: kase.id, status: 'IN_PROGRESS' } })
    for (const [uid, duty] of [[resident1.id, '申请人'], [staff.id, '初审与协同'], [lawyer1.id, '承办律师'], [judicial.id, '协同单位']]) {
      await prisma.serviceOrderParticipant.create({ data: { serviceOrderId: order.id, userId: uid, duty } })
    }
    await prisma.material.createMany({ data: [
      { caseId: kase.id, name: '劳动合同（12人）', kind: '合同', status: 'VERIFIED', uploadedById: resident1.id },
      { caseId: kase.id, name: '工资银行流水', kind: '票据', status: 'VERIFIED', uploadedById: resident1.id },
      { caseId: kase.id, name: '考勤记录', kind: '其他', status: 'NEEDS_CORRECTION', note: '缺少5月考勤，请补充', uploadedById: resident1.id },
    ] })
    await prisma.task.createMany({ data: [
      { caseId: kase.id, type: 'COORDINATION', title: '联动劳动监察部门核实欠薪情况', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'IN_PROGRESS', createdById: staff.id, dueDate: new Date(now + 3 * day) },
      { caseId: kase.id, type: 'MATERIAL_SUPPLEMENT', title: '补交5月考勤记录', assigneeRole: 'RESIDENT', assigneeId: resident1.id, status: 'OPEN', createdById: lawyer1.id, dueDate: new Date(now + 4 * day) },
      { caseId: kase.id, type: 'DEADLINE_WATCH', title: '仲裁时效仅剩约20天：优先推进', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'OPEN', createdById: staff.id, dueDate: new Date(now + 2 * day) },
    ] })
    await prisma.appointment.create({ data: { caseId: kase.id, lawyerId: lawyer1.id, scheduledAt: new Date(now + 2 * day), location: '阳光社区服务中心二楼调解室', status: 'CONFIRMED', note: '集体咨询，请12名员工派3名代表参加' } })
    await prisma.conflictCheck.create({ data: { caseId: kase.id, lawyerId: lawyer1.id, parties: '味美餐饮管理有限公司', hasConflict: false, note: '本所及本人与该企业无代理关系' } })
    await prisma.deadlineReminder.create({ data: { caseId: kase.id, channel: 'MESSAGE', note: '已告知居民仲裁时效临近，请尽快备齐材料', timeliness: 'TIMELY', daysLeftAtReminder: 25, remindedById: staff.id, createdAt: new Date(now - 5 * day) } })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: resident1.id, action: '提交咨询', detail: '线上提交劳动纠纷咨询' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：法律援助；经济困难初审通过' },
      { caseId: kase.id, actorId: staff.id, action: '指派律师', detail: '指派值班律师 陈明远' },
      { caseId: kase.id, actorId: lawyer1.id, action: '利益冲突核查', detail: '无冲突' },
      { caseId: kase.id, actorId: lawyer1.id, action: '接受案件', detail: '进入服务流程' },
    ] })
    return kase
  })

  // 2) 家庭暴力婚姻家事：严格保密，已分流待律师接案
  await ensureCase('LA20260905-0002', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260905-0002',
        title: '遭受家庭暴力申请人身安全保护令及离婚',
        type: 'MARRIAGE_FAMILY',
        description: '申请人长期遭受配偶殴打，最近一次致轻微伤，已报警并取得告诫书。希望申请人身安全保护令并咨询离婚与子女抚养问题。',
        source: 'HOTLINE',
        status: 'AWAITING_LAWYER',
        urgency: 'URGENT',
        priority: 'URGENT',
        confidentiality: 'STRICT',
        category: 'LEGAL_AID',
        applicantName: '刘桂芳',
        applicantPhone: '13911110002',
        applicantAddress: '朝阳街道和平里小区',
        residentId: resident2.id,
        familyIncome: 2600,
        isDomesticViolence: true,
        dvSignalThreat: true,
        dvSignalHarm: true,
        dvSignalControl: false,
        dvSignalNote: '打、威胁、赶出家门',
        dvHandled: true,
        involvesMinor: true,
        opposingParties: '配偶王某',
        street: '朝阳街道',
        reviewedById: staff.id,
        reviewedAt: new Date(now - 3 * day),
        reviewNotes: '家暴风险高，严格保密，建议法律援助并联动妇联、公安。',
        incomeQualified: true,
        ruleNotes: '家庭暴力案件：最高优先级+严格保密；涉未成年人：保密+高优先级',
        keyDates: { create: [{ label: '人身安全保护令申请建议期限', date: new Date(now + 7 * day), kind: 'other' }] },
      },
    })
    const order = await prisma.serviceOrder.create({ data: { orderNo: 'FW-LA20260905-0002', caseId: kase.id, status: 'IN_PROGRESS' } })
    for (const [uid, duty] of [[resident2.id, '申请人'], [staff.id, '初审与协同'], [judicial.id, '协同单位（司法所）'], [women.id, '协同单位（妇联）'], [police.id, '协同单位（派出所）']]) {
      await prisma.serviceOrderParticipant.create({ data: { serviceOrderId: order.id, userId: uid, duty } })
    }
    await prisma.material.createMany({ data: [
      { caseId: kase.id, name: '报警回执与告诫书', kind: '其他', status: 'VERIFIED', uploadedById: staff.id },
      { caseId: kase.id, name: '医院诊断证明', kind: '鉴定', status: 'RECEIVED', uploadedById: resident2.id },
    ] })
    await prisma.task.createMany({ data: [
      { caseId: kase.id, type: 'COORDINATION', title: '记录家暴安全信息（安全联系人/临时住所/报警情况）并转介司法所、妇联或派出所协同', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'DONE', createdById: staff.id, completedAt: new Date(now - 2 * day), completedById: staff.id },
      { caseId: kase.id, type: 'COORDINATION', title: '联动妇联/公安/司法所建立安全保护协作', assigneeRole: 'JUDICIAL', assigneeId: judicial.id, status: 'IN_PROGRESS', createdById: staff.id, dueDate: new Date(now + 1 * day) },
      { caseId: kase.id, type: 'COORDINATION', title: '通知监护人参与并联动未成年人保护中心', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'OPEN', createdById: staff.id, dueDate: new Date(now + 2 * day) },
    ] })

    // 家暴安全处置信息（安全联系人 / 临时住所 / 报警情况）
    await prisma.safetyPlan.create({ data: {
      caseId: kase.id,
      recordedById: staff.id,
      emergencyContactName: '刘桂兰（姐姐）',
      emergencyContactPhone: '13922220009',
      emergencyContactRel: '姐姐',
      shelterName: '区反家暴庇护中心',
      shelterAddress: '区妇女儿童活动中心临时庇护间',
      shelterArranged: true,
      policeReported: true,
      policeReportNo: 'J0902-3358',
      policeReportAt: new Date(now - 4 * day),
      policeNote: '派出所已出具家庭暴力告诫书',
      riskLevel: 'HIGH',
      notes: '加害人有持续施暴与威胁言辞，申请人暂避庇护中心，子女随行，注意保护现住址。',
    } })

    // 协同转介：司法所（已接收+授权）、妇联（已接收+授权）、派出所（待接收），均保留回访节点
    const refJudicial = await prisma.referral.create({ data: {
      caseId: kase.id, type: 'JUDICIAL', fromStreet: '朝阳街道', toUnit: '朝阳街道司法所',
      isSafetyReferral: true, reason: '家暴风险案件，协同推进人身安全保护令申请', status: 'ACCEPTED',
      createdById: staff.id, handledAt: new Date(now - 2 * day), acceptedById: judicial.id,
    } })
    const refWomen = await prisma.referral.create({ data: {
      caseId: kase.id, type: 'WOMEN_FEDERATION', fromStreet: '朝阳街道', toUnit: '朝阳街道妇女联合会',
      isSafetyReferral: true, reason: '家暴风险案件，妇联提供庇护、心理疏导与维权支持', status: 'ACCEPTED',
      createdById: staff.id, handledAt: new Date(now - 2 * day), acceptedById: women.id,
    } })
    await prisma.referral.create({ data: {
      caseId: kase.id, type: 'POLICE', fromStreet: '朝阳街道', toUnit: '朝阳路派出所',
      isSafetyReferral: true, reason: '家暴风险案件，请持续关注告诫书执行与人身安全', status: 'PENDING',
      createdById: staff.id,
    } })
    await prisma.referralAuthorization.createMany({ data: [
      { referralId: refJudicial.id, userId: judicial.id, grantedById: staff.id },
      { referralId: refWomen.id, userId: women.id, grantedById: staff.id },
    ] })
    await prisma.referralFollowUp.createMany({ data: [
      { referralId: refJudicial.id, scheduledAt: new Date(now + 5 * day) },
      { referralId: refWomen.id, scheduledAt: new Date(now + 3 * day), result: '已电话回访，申请人情绪稳定，继续在庇护中心暂住', doneAt: new Date(now - 1 * day), doneById: women.id },
    ] })

    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '热线转入登记', detail: '12348热线转入，工作人员代录' },
      { caseId: kase.id, actorId: null, action: '家暴风险信号识别', detail: '咨询描述中检出威胁、伤害相关表述，按家暴案件严格保密处理' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：法律援助；严格保密' },
      { caseId: kase.id, actorId: staff.id, action: '记录家暴安全信息', detail: '安全联系人：刘桂兰；临时住所：已安排；报警情况：已报警（告诫书）' },
      { caseId: kase.id, actorId: staff.id, action: '发起家暴协同转介', detail: '转介至 司法所、妇联、派出所 协同处理；律师咨询不孤立推进' },
      { caseId: kase.id, actorId: judicial.id, action: '转介处理', detail: '朝阳街道司法所：ACCEPTED（接收人已获授权查看联系方式与住址）' },
      { caseId: kase.id, actorId: women.id, action: '转介处理', detail: '朝阳街道妇女联合会：ACCEPTED（接收人已获授权查看联系方式与住址）' },
    ] })
    return kase
  })

  // 3) 老人赡养：线下纸质补录 + 志愿者上门
  await ensureCase('LA20260908-0003', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260908-0003',
        title: '八旬老人要求子女履行赡养义务',
        type: 'MARRIAGE_FAMILY',
        description: '申请人82岁，独居，行动不便不会使用智能手机。两名子女长期不支付赡养费、不探望。社区走访时老人口头求助，由工作人员纸质登记补录。',
        source: 'OFFLINE_PAPER',
        status: 'CLASSIFIED',
        urgency: 'NORMAL',
        priority: 'HIGH',
        category: 'LEGAL_AID',
        applicantName: '王李氏',
        applicantPhone: null,
        familyIncome: 1200,
        isElderlySupport: true,
        isDisabled: true,
        opposingParties: '长子王某某、次女王某某',
        street: '朝阳街道',
        reviewedById: staff.id,
        reviewedAt: new Date(now - 2 * day),
        reviewNotes: '老人赡养案件，经济困难初审通过；老人无法线上操作，安排志愿者上门协助。',
        incomeQualified: true,
        ruleNotes: '老人赡养：高优先级，可安排上门；线下纸质补录',
      },
    })
    const order = await prisma.serviceOrder.create({ data: { orderNo: 'FW-LA20260908-0003', caseId: kase.id, status: 'IN_PROGRESS' } })
    for (const [uid, duty] of [[staff.id, '补录与初审'], [volunteer.id, '上门协助'], [judicial.id, '协同单位']]) {
      await prisma.serviceOrderParticipant.create({ data: { serviceOrderId: order.id, userId: uid, duty } })
    }
    await prisma.material.createMany({ data: [
      { caseId: kase.id, name: '户口本复印件', kind: '证件', status: 'RECEIVED', note: '纸质件由社区扫描补录', uploadedById: staff.id },
      { caseId: kase.id, name: '低保证明', kind: '证件', status: 'MISSING', note: '待志愿者上门协助调取' },
    ] })
    await prisma.task.create({ data: { caseId: kase.id, type: 'HOME_VISIT', title: '上门协助老人整理与上传证据材料', assigneeRole: 'VOLUNTEER', assigneeId: volunteer.id, status: 'OPEN', createdById: staff.id, dueDate: new Date(now + 3 * day) } })

    // 材料线下代传：一张已完成（涉及原件全链：取走→扫描→归还→居民确认 + 用途/销毁提醒）
    const proxyDone = await prisma.materialProxy.create({ data: {
      caseId: kase.id, materialName: '老人身份证', reason: '老人独居不会线上上传，由志愿者上门扫描原件',
      method: 'PROXY_SCAN', involvesOriginal: true, purpose: '用于赡养纠纷法律援助资格审查与举证',
      status: 'CONFIRMED', requestedById: staff.id, volunteerId: volunteer.id,
      scheduledAt: new Date(now - 3 * day), pickedUpAt: new Date(now - 2 * day), scannedAt: new Date(now - 2 * day),
      returnedAt: new Date(now - 2 * day), residentConfirmedAt: new Date(now - 1 * day), completedAt: new Date(now - 1 * day),
      destroyNoticeSentAt: new Date(now - 1 * day), note: '上门当日取原件扫描后即归还',
    } })
    await prisma.material.create({ data: {
      caseId: kase.id, name: '老人身份证', kind: '扫描件', status: 'RECEIVED',
      note: '志愿者上门代传（原件扫描），律师端证据已更新为已提交待核验', uploadedById: volunteer.id,
      method: 'PROXY_SCAN', proxyId: proxyDone.id, purpose: '用于赡养纠纷法律援助资格审查与举证',
      originalReturned: true, noticeSentAt: new Date(now - 1 * day),
    } })
    // 一张待认领：低保证明待志愿者上门代交复印件
    await prisma.materialProxy.create({ data: {
      caseId: kase.id, materialName: '低保证明', reason: '老人行动不便，需志愿者上门代交复印件',
      method: 'PROXY_COPY', involvesOriginal: false, requestedById: staff.id, status: 'REQUESTED',
    } })
    await prisma.task.create({ data: { caseId: kase.id, type: 'MATERIAL_PROXY', title: '上门代传材料：低保证明', description: '预约上门代交复印件（不带走原件）', assigneeRole: 'VOLUNTEER', createdById: staff.id, dueDate: new Date(now + 2 * day) } })

    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '线下补录', detail: '老人不会线上上传，社区纸质登记后代为补录' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：法律援助' },
      { caseId: kase.id, actorId: staff.id, action: '发起材料代传', detail: '老人身份证（上门扫描），待志愿者认领' },
      { caseId: kase.id, actorId: volunteer.id, action: '志愿者认领代传', detail: '认领材料：老人身份证；预约上门' },
      { caseId: kase.id, actorId: volunteer.id, action: '代传：取走原件', detail: '老人身份证' },
      { caseId: kase.id, actorId: volunteer.id, action: '代传：拍照/扫描入卷', detail: '老人身份证 已代为扫描，证据状态更新为「已提交待核验」' },
      { caseId: kase.id, actorId: volunteer.id, action: '代传：原件归还', detail: '老人身份证 已归还居民，待居民确认' },
      { caseId: kase.id, actorId: staff.id, action: '代传完成并居民确认', detail: '老人身份证 已完成代传；已向居民告知材料用途与销毁/返还提醒' },
    ] })
    return kase
  })

  // 4) 房屋租赁纠纷：待初审（含对方已起诉标记）
  await ensureCase('LA20260912-0004', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260912-0004',
        title: '房东不退押金并起诉要求腾房',
        type: 'HOUSING_RENTAL',
        description: '租约到期后房东以房屋损耗为由拒退押金6800元，且已向法院起诉要求支付违约金。申请人收到法院传票，需尽快应诉。',
        source: 'COMMUNITY_EVENT',
        status: 'SUBMITTED',
        urgency: 'HIGH',
        priority: 'HIGH',
        applicantName: '张大山',
        applicantPhone: '13911110001',
        residentId: resident1.id,
        familyIncome: 4500,
        opponentSued: true,
        opposingParties: '房东刘某',
        statuteOfLimitations: new Date(now + 25 * day),
        incidentDate: new Date(now - 1065 * day),
        street: '朝阳街道',
        ruleNotes: '对方已起诉：需尽快应诉；诉讼时效临近：升级为紧急',
        keyDates: { create: [{ label: '法院传票答辩期届满', date: new Date(now + 12 * day), kind: 'court' }] },
      },
    })
    await prisma.material.create({ data: { caseId: kase.id, name: '房屋租赁合同', kind: '合同', status: 'RECEIVED', uploadedById: resident1.id } })
    await prisma.caseEvent.create({ data: { caseId: kase.id, actorId: staff2.id, action: '活动现场登记', detail: '社区法治宣传日活动现场咨询登记' } })
    return kase
  })

  // 5) 消费维权：已结案归档（含满意度与工时，供统计演示）
  await ensureCase('LA20260820-0005', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260820-0005',
        title: '健身房跑路要求退还预付款',
        type: 'CONSUMER_RIGHTS',
        description: '健身房突然停业，会员卡余额3200元无法退还。经热线解答指导，申请人已向市场监管部门投诉并登记债权。',
        source: 'HOTLINE',
        status: 'CLOSED',
        urgency: 'NORMAL',
        priority: 'NORMAL',
        category: 'HOTLINE_ANSWER',
        applicantName: '刘桂芳',
        applicantPhone: '13911110002',
        residentId: resident2.id,
        familyIncome: 5200,
        opposingParties: '某健身服务有限公司',
        street: '朝阳街道',
        reviewedById: staff.id,
        reviewedAt: new Date(now - 22 * day),
        reviewNotes: '事实清楚、标的较小，热线解答指引投诉渠道即可。',
        incomeQualified: false,
        closedAt: new Date(now - 18 * day),
      },
    })
    await prisma.serviceOrder.create({ data: { orderNo: 'FW-LA20260820-0005', caseId: kase.id, status: 'DONE' } })
    await prisma.archive.create({ data: {
      caseId: kase.id,
      consultationOpinion: '指导申请人向市场监管部门投诉并保留付款凭证，建议通过集体诉讼登记债权。',
      materialCorrections: '无需补正',
      referralDestination: '市场监督管理局消费者协会',
      lawyerHours: 1.5,
      followUpResult: '申请人已完成投诉登记，等待统一处置。',
      satisfaction: 5,
      satisfactionNote: '解答很清楚，谢谢工作人员。',
      closedById: staff.id,
      closedAt: new Date(now - 18 * day),
    } })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '热线转入登记' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：热线解答' },
      { caseId: kase.id, actorId: staff.id, action: '结案归档', detail: '热线解答完成' },
    ] })
    return kase
  })

  // 6) 未成年人权益：司法所转介中
  await ensureCase('LA20260910-0006', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260910-0006',
        title: '未成年人校园周边被侵权索赔咨询',
        type: 'NEIGHBORHOOD_TORT',
        description: '14岁学生放学途中被邻居家犬只咬伤，医疗费2800元，犬主拒绝赔偿。监护人咨询索赔途径。',
        source: 'ONLINE',
        status: 'REFERRED',
        urgency: 'NORMAL',
        priority: 'HIGH',
        confidentiality: 'CONFIDENTIAL',
        category: 'JUDICIAL_REFERRAL',
        applicantName: '刘桂芳',
        applicantPhone: '13911110002',
        residentId: resident2.id,
        familyIncome: 5200,
        involvesMinor: true,
        isMinorRights: true,
        opposingParties: '邻居赵某',
        street: '朝阳街道',
        reviewedById: staff.id,
        reviewedAt: new Date(now - 4 * day),
        reviewNotes: '涉未成年人，先由司法所组织人民调解，调解不成再转法律援助。',
        incomeQualified: false,
        ruleNotes: '涉未成年人：保密+高优先级',
      },
    })
    const order = await prisma.serviceOrder.create({ data: { orderNo: 'FW-LA20260910-0006', caseId: kase.id, status: 'IN_PROGRESS' } })
    for (const [uid, duty] of [[resident2.id, '申请人（监护人）'], [staff.id, '初审与协同'], [judicial.id, '人民调解']]) {
      await prisma.serviceOrderParticipant.create({ data: { serviceOrderId: order.id, userId: uid, duty } })
    }
    await prisma.referral.create({ data: { caseId: kase.id, type: 'JUDICIAL', fromStreet: '朝阳街道', toUnit: '朝阳街道司法所人民调解委员会', reason: '涉未成年人侵权纠纷，先行人民调解', status: 'ACCEPTED', createdById: staff.id, handledAt: new Date(now - 3 * day) } })
    await prisma.task.create({ data: { caseId: kase.id, type: 'COORDINATION', title: '通知监护人参与并联动未成年人保护中心', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'DONE', createdById: staff.id, completedAt: new Date(now - 3 * day), completedById: staff.id } })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: resident2.id, action: '提交咨询' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：司法所转介（人民调解）' },
      { caseId: kase.id, actorId: judicial.id, action: '接受转介', detail: '司法所受理人民调解' },
    ] })
    return kase
  })

  // 7) 租赁纠纷：无明确时效日期，按事件日期推算期限（证据不足 → 高风险）
  await ensureCase('LA20260913-0007', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260913-0007',
        title: '租约到期近三年，房东拒退押金',
        type: 'HOUSING_RENTAL',
        description: '租约到期后房东以物品损耗为由拒退押金5200元，申请人多次协商未果，担心拖过诉讼时效。',
        source: 'ONLINE',
        status: 'SUBMITTED',
        urgency: 'NORMAL',
        priority: 'HIGH',
        applicantName: '张大山',
        applicantPhone: '13911110001',
        residentId: resident1.id,
        familyIncome: 4500,
        opposingParties: '房东周某',
        incidentDate: new Date(now - 1055 * day),
        street: '朝阳街道',
        ruleNotes: '期限按民事诉讼时效（3年）自事件日期推算',
      },
    })
    await prisma.material.create({ data: { caseId: kase.id, name: '租赁合同照片', kind: '合同', status: 'RECEIVED', uploadedById: resident1.id } })
    await prisma.caseEvent.create({ data: { caseId: kase.id, actorId: resident1.id, action: '提交咨询' } })
    return kase
  })

  // 8) 欠薪纠纷：仲裁时效已过（EXPIRED），含逾期提醒记录
  await ensureCase('LA20260913-0008', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260913-0008',
        title: '被拖欠工资一年多，担心已过仲裁时效',
        type: 'LABOR_DISPUTE',
        description: '申请人离职时被拖欠两个月工资13000元，一直协商未果，近期才得知劳动仲裁时效问题，担心已经过期。',
        source: 'HOTLINE',
        status: 'SUBMITTED',
        urgency: 'HIGH',
        priority: 'URGENT',
        applicantName: '刘桂芳',
        applicantPhone: '13911110002',
        residentId: resident2.id,
        familyIncome: 3800,
        isWageArrearsGroup: true,
        opposingParties: '某家政服务公司',
        incidentDate: new Date(now - 400 * day),
        street: '朝阳街道',
        ruleNotes: '欠薪群体：高优先级，联动劳动监察；关键期限已届满：升级为紧急',
      },
    })
    await prisma.deadlineReminder.create({
      data: { caseId: kase.id, channel: 'PHONE', note: '联系居民告知仲裁时效已过，建议尽快到社区评估补救途径', timeliness: 'MISSED', daysLeftAtReminder: -33, remindedById: staff.id, createdAt: new Date(now - 2 * day) },
    })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '热线转入登记' },
      { caseId: kase.id, actorId: staff.id, action: '期限提醒（电话）', detail: '联系居民告知仲裁时效已过；距期限 -33 天（逾期才提醒）' },
    ] })
    return kase
  })

  // 9) 婚姻家事：描述中出现威胁/控制财产/赶出家门，平台自动识别家暴风险，待社区安全处置（律师不得孤立推进）
  await ensureCase('LA20260914-0009', async () => {
    const kase = await prisma.case.create({
      data: {
        caseNo: 'LA20260914-0009',
        title: '配偶威胁并控制工资卡、赶出家门，咨询离婚与人身保护',
        type: 'MARRIAGE_FAMILY',
        description: '申请人电话求助：配偶长期威胁要弄死她，上个月动手打了她，还把工资卡和身份证没收、控制财产，昨晚将其锁在门外赶出家门。申请人现暂住同事家，不敢回家取衣物，担心对方报复。',
        source: 'HOTLINE',
        status: 'SUBMITTED',
        urgency: 'URGENT',
        priority: 'URGENT',
        confidentiality: 'STRICT',
        category: null,
        applicantName: '周敏（化名）',
        applicantPhone: '13900000077',
        applicantAddress: '朝阳街道建设路段（详细地址待工作人员核实后录入）',
        familyIncome: 2100,
        isDomesticViolence: true,
        dvSignalThreat: true,
        dvSignalHarm: true,
        dvSignalControl: true,
        dvSignalNote: '威胁、弄死、动手、工资卡、身份证、控制财产、锁在门外、赶出家门、报复',
        dvHandled: false,
        opposingParties: '配偶张某',
        street: '朝阳街道',
        ruleNotes: '家庭暴力风险：最高优先级 + 严格保密（对未承办人员隐藏申请人身份）',
      },
    })
    await prisma.task.create({ data: {
      caseId: kase.id, type: 'COORDINATION',
      title: '记录家暴安全信息（安全联系人/临时住所/报警情况）并转介司法所、妇联或派出所协同',
      description: '咨询描述中出现威胁/恐吓、伤害/暴力、控制财产/经济控制描述，律师咨询不得孤立推进，请先完成安全处置',
      assigneeRole: 'STAFF', createdById: staff.id, dueDate: new Date(now + 1 * day),
    } })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '热线转入登记', detail: '12348热线转入，工作人员代录' },
      { caseId: kase.id, actorId: null, action: '家暴风险信号识别', detail: '婚姻家事咨询描述中检出威胁/恐吓、伤害/暴力、控制财产/经济控制相关表述，已按家暴案件严格保密并提示社区工作人员记录安全信息、发起协同转介' },
      { caseId: kase.id, actorId: null, action: '命中特殊规则', detail: '家庭暴力风险：最高优先级 + 严格保密（对未承办人员隐藏申请人身份）' },
    ] })
    return kase
  })

  // 启动时刷新全部案件的期限风险持久化字段（随时间推移保持准确）
  await refreshAllRisks()

  console.log('Seed completed.')
}

// 与后端规则一致的期限风险评估（简版，用于启动时刷新持久化字段）
const LIMITATION_YEARS = { LABOR_DISPUTE: 1, HOUSING_RENTAL: 3 }
function assessRisk(kase) {
  let deadline = kase.statuteOfLimitations ? new Date(kase.statuteOfLimitations) : null
  if (!deadline) {
    const kd = (kase.keyDates || [])
      .filter((k) => k.kind === 'statute' || k.kind === 'court')
      .map((k) => new Date(k.date))
      .sort((a, b) => a - b)[0]
    if (kd) deadline = kd
  }
  if (!deadline && LIMITATION_YEARS[kase.type] && kase.incidentDate) {
    deadline = new Date(kase.incidentDate)
    deadline.setFullYear(deadline.getFullYear() + LIMITATION_YEARS[kase.type])
  }
  if (!deadline) return { level: 'NONE', deadline: null, reasons: [] }
  const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86400000)
  if (['CLOSED', 'REFERRED'].includes(kase.status)) return { level: 'NONE', deadline, reasons: ['案件已办结/已转介'] }
  const reasons = []
  let level
  if (daysLeft < 0) { level = 'EXPIRED'; reasons.push(`关键期限已于 ${-daysLeft} 天前届满`) }
  else if (daysLeft <= 30) { level = 'HIGH'; reasons.push(`距关键期限仅剩 ${daysLeft} 天`) }
  else if (daysLeft <= 90) { level = 'MEDIUM'; reasons.push(`距关键期限还有 ${daysLeft} 天`) }
  else { level = 'LOW'; reasons.push(`距关键期限 ${daysLeft} 天`) }
  const verified = (kase.materials || []).filter((m) => m.status === 'VERIFIED').length
  if (level !== 'EXPIRED' && daysLeft <= 90 && verified === 0) {
    reasons.push('尚无已核验证据，举证准备不足')
    if (level === 'MEDIUM') level = 'HIGH'
  }
  return { level, deadline, reasons }
}

async function refreshAllRisks() {
  const cases = await prisma.case.findMany({ include: { materials: { select: { status: true } }, keyDates: true } })
  for (const c of cases) {
    const r = assessRisk(c)
    await prisma.case.update({
      where: { id: c.id },
      data: { deadlineRisk: r.level, estimatedDeadline: r.deadline, deadlineRiskReason: r.reasons.join('；') || null },
    })
  }
  console.log(`Refreshed deadline risk for ${cases.length} cases`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
