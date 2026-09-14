import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { CasesController } from './cases.controller'
import { CasesService } from './cases.service'

@Module({
  controllers: [CasesController],
  providers: [CasesService, PrismaService],
})
export class CasesModule {}
