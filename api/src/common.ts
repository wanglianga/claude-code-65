import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'

export const Roles = (...roles: string[]) => SetMetadata('roles', roles)
export const Public = () => SetMetadata('public', true)

export interface JwtUser {
  sub: string
  username: string
  role: string
  name: string
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])
    if (isPublic) return true
    const req = ctx.switchToHttp().getRequest()
    const header: string = req.headers['authorization'] || ''
    const token = header.replace(/^Bearer\s+/i, '')
    if (!token) throw new UnauthorizedException('未登录或登录已过期')
    try {
      req.user = await this.jwt.verifyAsync<JwtUser>(token)
    } catch {
      throw new UnauthorizedException('未登录或登录已过期')
    }
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [ctx.getHandler(), ctx.getClass()])
    if (roles && roles.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('当前角色无权执行此操作')
    }
    return true
  }
}

export const CurrentUser = createParamDecorator((_data, ctx: ExecutionContext): JwtUser => {
  return ctx.switchToHttp().getRequest().user
})
