import { Controller, Get, Module } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { Roles } from './common'

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async overview() {
    const [
      total, closed, byStatus, byType, byCategory, bySource, byPriority,
      dv, wage, elderly, minor, disabled, opponentSued,
      satisfactionAgg, hoursAgg, archives, materials, tasksOpen,
    ] = await Promise.all([
      this.prisma.case.count(),
      this.prisma.case.count({ where: { status: 'CLOSED' } }),
      this.prisma.case.groupBy({ by: ['status'], _count: true }),
      this.prisma.case.groupBy({ by: ['type'], _count: true }),
      this.prisma.case.groupBy({ by: ['category'], _count: true }),
      this.prisma.case.groupBy({ by: ['source'], _count: true }),
      this.prisma.case.groupBy({ by: ['priority'], _count: true }),
      this.prisma.case.count({ where: { isDomesticViolence: true } }),
      this.prisma.case.count({ where: { isWageArrearsGroup: true } }),
      this.prisma.case.count({ where: { isElderlySupport: true } }),
      this.prisma.case.count({ where: { OR: [{ isMinorRights: true }, { involvesMinor: true }] } }),
      this.prisma.case.count({ where: { isDisabled: true } }),
      this.prisma.case.count({ where: { opponentSued: true } }),
      this.prisma.archive.aggregate({ _avg: { satisfaction: true }, _count: { satisfaction: true } }),
      this.prisma.archive.aggregate({ _sum: { lawyerHours: true } }),
      this.prisma.archive.findMany({ select: { closedAt: true, case: { select: { createdAt: true } } } }),
      this.prisma.material.count(),
      this.prisma.task.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ])
    let avgCloseDays: number | null = null
    if (archives.length) {
      const sum = archives.reduce((acc, a) => acc + (a.closedAt.getTime() - a.case.createdAt.getTime()) / 86400000, 0)
      avgCloseDays = Math.round((sum / archives.length) * 10) / 10
    }
    const toMap = (rows: any[], key: string) =>
      Object.fromEntries(rows.map((r) => [r[key] ?? '未分流', r._count]))
    return {
      total, closed, open: total - closed, materials, tasksOpen,
      avgCloseDays,
      satisfactionAvg: satisfactionAgg._avg.satisfaction ? Math.round(satisfactionAgg._avg.satisfaction * 100) / 100 : null,
      satisfactionCount: satisfactionAgg._count.satisfaction,
      lawyerHoursTotal: hoursAgg._sum.lawyerHours || 0,
      byStatus: toMap(byStatus, 'status'),
      byType: toMap(byType, 'type'),
      byCategory: toMap(byCategory, 'category'),
      bySource: toMap(bySource, 'source'),
      byPriority: toMap(byPriority, 'priority'),
      special: { domesticViolence: dv, wageArrearsGroup: wage, elderlySupport: elderly, minorRelated: minor, disabled, opponentSued },
    }
  }

  async lawyers() {
    const lawyers = await this.prisma.user.findMany({
      where: { role: 'LAWYER' },
      select: { id: true, name: true, organization: true, onLeave: true },
    })
    return Promise.all(lawyers.map(async (l) => {
      const [assigned, closedCases, hours, sat] = await Promise.all([
        this.prisma.case.count({ where: { lawyerId: l.id } }),
        this.prisma.case.count({ where: { lawyerId: l.id, status: 'CLOSED' } }),
        this.prisma.archive.aggregate({ _sum: { lawyerHours: true }, where: { case: { lawyerId: l.id } } }),
        this.prisma.archive.aggregate({ _avg: { satisfaction: true }, where: { case: { lawyerId: l.id }, satisfaction: { not: null } } }),
      ])
      return {
        ...l,
        assigned,
        closed: closedCases,
        hours: hours._sum.lawyerHours || 0,
        satisfactionAvg: sat._avg.satisfaction ? Math.round(sat._avg.satisfaction * 100) / 100 : null,
      }
    }))
  }
}

@Controller('stats')
export class StatsController {
  constructor(private svc: StatsService) {}

  @Get('overview')
  @Roles('ADMIN', 'STAFF', 'JUDICIAL')
  overview() {
    return this.svc.overview()
  }

  @Get('lawyers')
  @Roles('ADMIN', 'STAFF', 'JUDICIAL')
  lawyers() {
    return this.svc.lawyers()
  }
}

@Module({
  controllers: [StatsController],
  providers: [StatsService, PrismaService],
})
export class StatsModule {}
