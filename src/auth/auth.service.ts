import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) return null;
    // Normalize field names for frontend compatibility
    return {
      ...user,
      onboardingComplete: user.onboardingDone,
    };
  }

  async completeOnboarding(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingDone: true, updatedAt: new Date() },
    });
  }

  /**
   * GOVERNANCE: Self-service role assignment during onboarding is restricted.
   * Users may ONLY set their own role to 'client'.
   * Elevated roles (consultant, admin, super_admin) cannot be self-assigned.
   * Role elevation is exclusively a super_admin operation via /admin/users/:id/role.
   */
  async setOnboardingRole(userId: string, role: string, consents?: string[]) {
    // Only 'client' is allowed for self-service onboarding
    const allowedSelfServiceRoles = ['client'];

    if (!allowedSelfServiceRoles.includes(role)) {
      throw new ForbiddenException(
        'Role elevation is not permitted during onboarding. Contact your administrator to assign elevated roles.',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'client', onboardingDone: true, updatedAt: new Date() },
    });

    if (consents && consents.length > 0) {
      for (const documentType of consents) {
        await this.prisma.consentRecord.upsert({
          where: { userId_documentType: { userId, documentType } },
          create: {
            id: uuidv4(),
            userId,
            documentType,
            documentVersion: '1.0',
          },
          update: { signedAt: new Date() },
        });
      }
    }

    return { success: true, role: updated.role, onboardingComplete: true };
  }
}
