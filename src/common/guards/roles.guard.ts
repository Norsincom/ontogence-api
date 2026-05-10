import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No user in context');

    const roleHierarchy: Record<UserRole, number> = {
      client: 0,
      consultant: 1,
      admin: 2,
      super_admin: 3,
    };

    const userLevel = roleHierarchy[user.role as UserRole] ?? -1;
    const minRequired = Math.min(...requiredRoles.map((r) => roleHierarchy[r] ?? 99));

    if (userLevel < minRequired) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
