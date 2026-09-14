import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import { diskStorage } from 'multer'
import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { extname, join, resolve } from 'path'
import { CurrentUser, JwtUser, Roles } from '../common'
import { CasesService } from './cases.service'

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads')
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })

class KeyDateDto {
  @IsString() @IsNotEmpty() label: string
  @IsDateString() date: string
  @IsOptional() @IsString() kind?: string
}

class CreateCaseDto {
  @IsString() @IsNotEmpty() title: string
  @IsIn(['LABOR_DISPUTE', 'MARRIAGE_FAMILY', 'HOUSING_RENTAL', 'NEIGHBORHOOD_TORT', 'CONSUMER_RIGHTS', 'ADMIN_RECONSIDERATION'])
  type: string
  @IsString() @IsNotEmpty() description: string
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) urgency?: string
  @IsOptional() @IsIn(['COMMUNITY_EVENT', 'HOTLINE', 'OFFLINE_PAPER', 'CROSS_STREET']) source?: string
  @IsOptional() @IsString() applicantName?: string
  @IsOptional() @IsString() applicantPhone?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) familyIncome?: number
  @IsOptional() @IsBoolean() isDisabled?: boolean
  @IsOptional() @IsBoolean() involvesMinor?: boolean
  @IsOptional() @IsBoolean() isWageArrearsGroup?: boolean
  @IsOptional() @IsBoolean() isDomesticViolence?: boolean
  @IsOptional() @IsBoolean() isElderlySupport?: boolean
  @IsOptional() @IsBoolean() isMinorRights?: boolean
  @IsOptional() @IsBoolean() opponentSued?: boolean
  @IsOptional() @IsString() opposingParties?: string
  @IsOptional() @IsDateString() statuteOfLimitations?: string
  @IsOptional() @IsString() deadlineNotes?: string
  @IsOptional() @IsString() street?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => KeyDateDto) keyDates?: KeyDateDto[]
}

class ReviewDto {
  @IsIn(['LEGAL_AID', 'PEOPLES_MEDIATION', 'JUDICIAL_REFERRAL', 'HOTLINE_ANSWER', 'COMMERCIAL_LAWYER'])
  category: string
  @IsOptional() @IsBoolean() incomeQualified?: boolean
  @IsOptional() @IsString() reviewNotes?: string
  @IsOptional() @IsString() referralTo?: string
}

class AssignDto {
  @IsString() @IsNotEmpty() lawyerId: string
}

class ConflictCheckDto {
  @IsBoolean() hasConflict: boolean
  @IsOptional() @IsString() parties?: string
  @IsOptional() @IsString() note?: string
}

class ReasonDto {
  @IsOptional() @IsString() reason?: string
}

class RequestMaterialDto {
  @IsString() @IsNotEmpty() name: string
  @IsOptional() @IsString() kind?: string
  @IsOptional() @IsString() note?: string
  @IsOptional() @IsDateString() dueDate?: string
}

class UpdateMaterialDto {
  @IsIn(['MISSING', 'RECEIVED', 'NEEDS_CORRECTION', 'VERIFIED']) status: string
  @IsOptional() @IsString() note?: string
}

class TaskDto {
  @IsString() @IsNotEmpty() title: string
  @IsOptional() @IsIn(['MATERIAL_SUPPLEMENT', 'HOME_VISIT', 'CONFLICT_CHECK', 'FOLLOW_UP', 'COORDINATION', 'REASSIGNMENT', 'DEADLINE_WATCH', 'OTHER'])
  type?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() assigneeId?: string
  @IsOptional() @IsIn(['RESIDENT', 'STAFF', 'LAWYER', 'JUDICIAL', 'VOLUNTEER']) assigneeRole?: string
  @IsOptional() @IsDateString() dueDate?: string
}

class UpdateTaskDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']) status: string
}

class ParticipantDto {
  @IsString() @IsNotEmpty() userId: string
  @IsOptional() @IsString() duty?: string
}

class AppointmentDto {
  @IsDateString() scheduledAt: string
  @IsOptional() @IsString() location?: string
  @IsOptional() @IsString() note?: string
  @IsOptional() @IsString() lawyerId?: string
}

class UpdateAppointmentDto {
  @IsIn(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']) status: string
}

class ReferralDto {
  @IsString() @IsNotEmpty() toUnit: string
  @IsOptional() @IsIn(['JUDICIAL', 'CROSS_STREET', 'OTHER_ORG']) type?: string
  @IsOptional() @IsString() toStreet?: string
  @IsOptional() @IsString() reason?: string
}

class UpdateReferralDto {
  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED']) status: string
}

class CloseDto {
  @IsOptional() @IsString() consultationOpinion?: string
  @IsOptional() @IsString() materialCorrections?: string
  @IsOptional() @IsString() referralDestination?: string
  @IsOptional() @Type(() => Number) lawyerHours?: number
  @IsOptional() @IsString() followUpResult?: string
}

class SatisfactionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) score: number
  @IsOptional() @IsString() note?: string
}

class FollowUpDto {
  @IsString() @IsNotEmpty() result: string
}

@Controller()
export class CasesController {
  constructor(private svc: CasesService) {}

  // ----- 案件 -----
  @Post('cases')
  @Roles('RESIDENT', 'STAFF', 'ADMIN')
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateCaseDto) {
    if (['STAFF', 'ADMIN'].includes(user.role) && !dto.applicantName) {
      throw new BadRequestException('工作人员代录时必须填写申请人姓名')
    }
    return this.svc.create(user, dto)
  }

  @Get('cases')
  findAll(@CurrentUser() user: JwtUser, @Query() q: any) {
    return this.svc.findAll(user, q)
  }

  @Get('cases/:id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.findOne(user, id)
  }

  @Post('cases/:id/review')
  @Roles('STAFF', 'ADMIN')
  review(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.svc.review(user, id, dto)
  }

  @Post('cases/:id/assign')
  @Roles('STAFF', 'ADMIN')
  assign(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.svc.assign(user, id, dto.lawyerId)
  }

  @Post('cases/:id/take')
  @Roles('LAWYER')
  take(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.take(user, id)
  }

  @Post('cases/:id/conflict-check')
  @Roles('LAWYER')
  conflictCheck(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ConflictCheckDto) {
    return this.svc.conflictCheck(user, id, dto)
  }

  @Post('cases/:id/accept')
  @Roles('LAWYER')
  accept(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.accept(user, id)
  }

  @Post('cases/:id/decline')
  @Roles('LAWYER')
  decline(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.svc.decline(user, id, dto)
  }

  // ----- 材料 -----
  @Post('cases/:id/materials')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const safe = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[^\w.一-龥-]+/g, '_').slice(-60)
        cb(null, `${randomUUID()}-${safe}`)
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  addMaterial(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() meta: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!meta?.name) throw new BadRequestException('材料名称必填')
    return this.svc.addMaterial(user, id, meta, file)
  }

  @Post('cases/:id/material-requests')
  @Roles('STAFF', 'ADMIN', 'LAWYER')
  requestMaterial(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RequestMaterialDto) {
    return this.svc.requestMaterial(user, id, dto)
  }

  @Patch('materials/:id')
  @Roles('STAFF', 'ADMIN', 'LAWYER')
  updateMaterial(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.svc.updateMaterial(user, id, dto)
  }

  @Get('materials/:id/file')
  async downloadMaterial(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const m = await this.svc.getMaterialFile(user, id)
    const path = resolve(UPLOAD_DIR, m.filePath!)
    if (!path.startsWith(resolve(UPLOAD_DIR)) || !existsSync(path)) {
      throw new BadRequestException('文件不存在')
    }
    res.download(path, m.name)
  }

  // ----- 任务 -----
  @Post('cases/:id/tasks')
  @Roles('STAFF', 'ADMIN', 'LAWYER', 'JUDICIAL', 'VOLUNTEER')
  addTask(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: TaskDto) {
    return this.svc.addTask(user, id, dto)
  }

  @Patch('tasks/:id')
  updateTask(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.svc.updateTask(user, id, dto)
  }

  @Get('tasks/mine')
  myTasks(@CurrentUser() user: JwtUser) {
    return this.svc.myTasks(user)
  }

  // ----- 服务单 -----
  @Post('cases/:id/participants')
  @Roles('STAFF', 'ADMIN', 'JUDICIAL')
  addParticipant(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ParticipantDto) {
    return this.svc.addParticipant(user, id, dto)
  }

  // ----- 预约 -----
  @Post('cases/:id/appointments')
  @Roles('STAFF', 'ADMIN', 'LAWYER')
  addAppointment(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AppointmentDto) {
    return this.svc.addAppointment(user, id, dto)
  }

  @Patch('appointments/:id')
  @Roles('STAFF', 'ADMIN', 'LAWYER')
  updateAppointment(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.svc.updateAppointment(user, id, dto)
  }

  // ----- 转介 -----
  @Post('cases/:id/referrals')
  @Roles('STAFF', 'ADMIN', 'JUDICIAL')
  addReferral(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ReferralDto) {
    return this.svc.addReferral(user, id, dto)
  }

  @Patch('referrals/:id')
  @Roles('STAFF', 'ADMIN', 'JUDICIAL')
  updateReferral(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateReferralDto) {
    return this.svc.updateReferral(user, id, dto)
  }

  @Get('referrals')
  @Roles('STAFF', 'ADMIN', 'JUDICIAL')
  listReferrals(@CurrentUser() user: JwtUser) {
    return this.svc.listReferrals(user)
  }

  // ----- 归档 -----
  @Post('cases/:id/close')
  @Roles('STAFF', 'ADMIN', 'LAWYER')
  close(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: CloseDto) {
    return this.svc.close(user, id, dto)
  }

  @Post('cases/:id/satisfaction')
  @Roles('RESIDENT')
  satisfaction(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SatisfactionDto) {
    return this.svc.satisfaction(user, id, dto)
  }

  @Post('cases/:id/follow-up')
  @Roles('STAFF', 'ADMIN', 'JUDICIAL')
  followUp(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: FollowUpDto) {
    return this.svc.followUp(user, id, dto)
  }
}
