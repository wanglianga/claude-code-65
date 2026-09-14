import { Body, Controller, Get, Module, Post, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Injectable } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from './prisma.service'
import { CurrentUser, JwtUser, Public } from './common'

class LoginDto {
  @IsString() @IsNotEmpty() username: string
  @IsString() @IsNotEmpty() password: string
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username } })
    if (!user || !bcrypt.compareSync(dto.password, user.password)) {
      throw new UnauthorizedException('用户名或密码错误')
    }
    const payload: JwtUser = { sub: user.id, username: user.username, role: user.role, name: user.name }
    return {
      token: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organization: user.organization,
        street: user.street,
        phone: user.phone,
        onLeave: user.onLeave,
      },
    }
  }

  async me(uid: string) {
    const u = await this.prisma.user.findUnique({ where: { id: uid } })
    if (!u) throw new UnauthorizedException('用户不存在')
    return {
      id: u.id, username: u.username, name: u.name, role: u.role,
      organization: u.organization, street: u.street, phone: u.phone, onLeave: u.onLeave,
    }
  }
}

@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto)
  }

  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.svc.me(user.sub)
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, PrismaService],
})
export class AuthModule {}
