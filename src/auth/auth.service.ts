import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async setOnboardingRole(userId: string, role: string, consents?: string[]) {
    const validRoles = ['client', 'consultant', 'admin', 'super_admin'];
    const safeRole = validRoles.includes(role) ? role : 'client';
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: safeRole as any, onboardingDone: true, updatedAt: new Date() },
    });
    if (consents && consents.length > 0) {
      for (const documentType of consents) {
        await this.prisma.consentRecord.upsert({
          where: { userId_documentType: { userId, documentType } },
          create: {
            id: require('uuid').v4(),
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
