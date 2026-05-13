import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        subscriptions: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const hasVaultAccess = user.subscriptions.length > 0;
    const purchasedServices = user.invoices
      .filter(inv => inv.status === 'paid')
      .map(inv => inv.description);

    return {
      ...user,
      hasVaultAccess,
      purchasedServices,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.clientProfile.findUnique({ where: { userId } });

    if (existing) {
      return this.prisma.clientProfile.update({
        where: { userId },
        data: { ...dto, updatedAt: new Date() },
      });
    }

    return this.prisma.clientProfile.create({
      data: {
        id: userId + '-profile',
        userId,
        ...dto,
        updatedAt: new Date(),
      },
    });
  }

  async getConsentRecords(userId: string) {
    return this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { signedAt: 'desc' } });
  }

  async signConsent(userId: string, documentType: string, documentVersion: string, ipAddress?: string) {
    return this.prisma.consentRecord.upsert({
      where: { userId_documentType: { userId, documentType } },
      update: { documentVersion, signedAt: new Date(), ipAddress: ipAddress || null },
      create: {
        id: `${userId}-${documentType}`,
        userId,
        documentType,
        documentVersion,
        ipAddress: ipAddress || null,
      },
    });
  }
}
