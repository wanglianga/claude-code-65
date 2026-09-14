import { Module, Controller, Get } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { PrismaService } from './prisma.service'
import { AuthGuard } from './common'
import { Public } from './common'
import { AuthModule } from './auth.module'
import { UsersModule } from './users.module'
import { CasesModule } from './cases/cases.module'
import { StatsModule } from './stats.module'

@Controller()
class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'legal-aid-api', time: new Date().toISOString() }
  }
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret',
      signOptions: { expiresIn: '12h' },
    }),
    AuthModule,
    UsersModule,
    CasesModule,
    StatsModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
