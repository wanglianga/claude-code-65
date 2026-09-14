import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Post, Query } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { IsBoolean, IsOptional, IsString } from 'class-validator'
import { PrismaService } from './prisma.service'
import { CurrentUser, JwtUser, Roles } from './common'

class LeaveDto {
  @IsBoolean() onLeave: boolean
  @IsOptional() @IsString() reason?: string
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list(role?: string) {
    return this.prisma.user.findMany({
      where: role ? { role: role as any } : {},
      select: { id: true, username: true, name: true, role: true, organization: true, street: true, phone: true, onLeave: true, leaveReason: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async lawyers() {
    const lawyers = await this.prisma.user.findMany({
      where: { role: 'LAWYER' },
      select: { id: true, name: true, organization: true, onLeave: true, leaveReason: true },
      orderBy: { name: 'asc' },
    })
    const withStats = await Promise.all(lawyers.map(async (l) => {
      const active = await this.prisma.case.count({ where: { lawyerId: l.id, status: { in: ['AWAITING_LAWYER', 'IN_SERVICE', 'MATERIAL_SUPPLEMENT'] } } })
      const hours = await this.prisma.archive.aggregate({ _sum: { lawyerHours: true }, where: { case: { lawyerId: l.id } } })
      return { ...l, activeCases: active, totalHours: hours._sum.lawyerHours || 0 }
    }))
    return withStats
  }

  async setLeave(user: JwtUser, targetId: string, dto: LeaveDto) {
    if (user.role !== 'ADMIN' && user.role !== 'STAFF' && user.sub !== targetId) {
      throw new ForbiddenException('只能修改自己的请假状态')
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } })
    if (!target || target.role !== 'LAWYER') throw new BadRequestException('仅律师账号支持请假状态')
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { onLeave: dto.onLeave, leaveReason: dto.onLeave ? (dto.reason || '临时请假') : null },
    })
    // 律师请假：其名下未正式接办的案件自动生成重新指派任务，提醒社区工作人员
    if (dto.onLeave) {
      const pending = await this.prisma.case.findMany({
        where: { lawyerId: targetId, status: { in: ['AWAITING_LAWYER', 'IN_SERVICE', 'MATERIAL_SUPPLEMENT'] } },
        select: { id: true, caseNo: true },
      })
      for (const c of pending) {
        await this.prisma.task.create({
          data: {
            caseId: c.id,
            type: 'REASSIGNMENT',
            title: `律师 ${target.name} 临时请假，请重新指派值班律师`,
            description: dto.reason || '律师临时请假',
            assigneeRole: 'STAFF',
            createdById: user.sub,
          },
        })
        await this.prisma.caseEvent.create({
          data: { caseId: c.id, actorId: user.sub, action: '律师请假', detail: `${target.name} 请假：${dto.reason || '临时请假'}，案件待重新指派` },
        })
      }
      return { ...updated, affectedCases: pending.length }
    }
    return { ...updated, affectedCases: 0 }
  }
}

@Controller('users')
export class UsersController {
  constructor(private svc: UsersService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'JUDICIAL')
  list(@Query('role') role?: string) {
    return this.svc.list(role)
  }

  @Get('lawyers')
  @Roles('ADMIN', 'STAFF', 'JUDICIAL', 'LAWYER')
  lawyers() {
    return this.svc.lawyers()
  }

  @Post(':id/leave')
  @Roles('ADMIN', 'STAFF', 'LAWYER')
  setLeave(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: LeaveDto) {
    return this.svc.setLeave(user, id, dto)
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService, PrismaService],
})
export class UsersModule {}
