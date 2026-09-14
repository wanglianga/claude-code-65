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
        residentId: resident2.id,
        familyIncome: 2600,
        isDomesticViolence: true,
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
    for (const [uid, duty] of [[resident2.id, '申请人'], [staff.id, '初审与协同'], [judicial.id, '协同单位（妇联/公安联动）']]) {
      await prisma.serviceOrderParticipant.create({ data: { serviceOrderId: order.id, userId: uid, duty } })
    }
    await prisma.material.createMany({ data: [
      { caseId: kase.id, name: '报警回执与告诫书', kind: '其他', status: 'VERIFIED', uploadedById: staff.id },
      { caseId: kase.id, name: '医院诊断证明', kind: '鉴定', status: 'RECEIVED', uploadedById: resident2.id },
    ] })
    await prisma.task.createMany({ data: [
      { caseId: kase.id, type: 'COORDINATION', title: '联动妇联/公安/司法所建立安全保护协作', assigneeRole: 'JUDICIAL', assigneeId: judicial.id, status: 'IN_PROGRESS', createdById: staff.id, dueDate: new Date(now + 1 * day) },
      { caseId: kase.id, type: 'COORDINATION', title: '通知监护人参与并联动未成年人保护中心', assigneeRole: 'STAFF', assigneeId: staff.id, status: 'OPEN', createdById: staff.id, dueDate: new Date(now + 2 * day) },
    ] })
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '热线转入登记', detail: '12348热线转入，工作人员代录' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：法律援助；严格保密' },
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
    await prisma.caseEvent.createMany({ data: [
      { caseId: kase.id, actorId: staff.id, action: '线下补录', detail: '老人不会线上上传，社区纸质登记后代为补录' },
      { caseId: kase.id, actorId: staff.id, action: '资格初审', detail: '分流为：法律援助' },
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

  console.log('Seed completed.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
