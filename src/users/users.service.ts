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

    // Super admins always have full vault access.
    // Non-admins have vault access if they have an active subscription OR
    // a paid one-time invoice that includes 'vaultAccess' in the description.
    const hasVaultFromInvoice = user.invoices.some(
      inv => inv.status === 'paid' && inv.description?.includes('vaultAccess'),
    );
    const hasVaultAccess =
      user.role === 'super_admin' ||
      user.subscriptions.length > 0 ||
      hasVaultFromInvoice;
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
    // Build the Prisma-safe data object — convert string fields to correct types
    const { dateOfBirth, height, weight, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest, updatedAt: new Date() };

    // dateOfBirth: DTO accepts YYYY-MM-DD string; Prisma expects DateTime
    if (dateOfBirth !== undefined) {
      data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth + 'T00:00:00.000Z') : null;
    }

    // height / weight: coerce to number in case they arrive as strings
    if (height !== undefined) {
      data.height = height !== null && height !== undefined ? Number(height) : null;
    }
    if (weight !== undefined) {
      data.weight = weight !== null && weight !== undefined ? Number(weight) : null;
    }

    const existing = await this.prisma.clientProfile.findUnique({ where: { userId } });
    if (existing) {
      return this.prisma.clientProfile.update({ where: { userId }, data });
    }
    return this.prisma.clientProfile.create({
      data: { id: userId + '-profile', userId, ...data },
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
