import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { generateNextOntId } from '../utils/ontid.util';

const SUPER_ADMIN_EMAIL = 'admin@ontogence.com';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const token = authHeader.split(' ')[1];

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      const clerkId = payload.sub;

      // Find or create user in our DB
      let user = await this.prisma.user.findUnique({ where: { clerkId } });

      if (!user) {
        // Fetch from Clerk to get email/name
        const clerkUser = await clerkClient.users.getUser(clerkId);
        const email = clerkUser.emailAddresses[0]?.emailAddress || '';
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || null;

        // Auto-assign super_admin role for the designated admin email
        const role = email === SUPER_ADMIN_EMAIL ? 'super_admin' : 'client';

        // Generate unique ONTID — server-side, sequential, collision-safe
        const ontId = await generateNextOntId(this.prisma);

        user = await this.prisma.user.create({
          data: {
            id: clerkId,
            clerkId,
            email,
            name,
            avatarUrl: clerkUser.imageUrl || null,
            role: role as any,
            ontId,
            // Super admin skips onboarding
            onboardingDone: email === SUPER_ADMIN_EMAIL,
          },
        });
      } else {
        // Ensure existing users without an ONTID get one assigned (backfill safety net)
        if (!user.ontId) {
          const ontId = await generateNextOntId(this.prisma);
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { ontId },
          });
        }
        if (user.email === SUPER_ADMIN_EMAIL && user.role !== 'super_admin') {
          // Promote existing admin@ontogence.com user to super_admin if not already
          user = await this.prisma.user.update({
            where: { id: user.id },
            data: { role: 'super_admin', onboardingDone: true },
          });
        }
      }

      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
