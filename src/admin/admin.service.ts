import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers(page = 1, limit = 50, search?: string) {
    const skip = (page - 1) * limit;
    const where = search
      ? { OR: [{ email: { contains: search } }, { name: { contains: search } }] }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        protocols: {
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          orderBy: { updatedAt: 'desc' },
        },
        uploads: { orderBy: { uploadedAt: 'desc' }, take: 20 },
        timelineEvents: { orderBy: { occurredAt: 'desc' }, take: 20 },
        biomarkerLogs: { orderBy: { loggedAt: 'desc' }, take: 20 },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateUserRole(userId: string, role: UserRole, adminId: string) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role, updatedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'user_role_changed',
        resourceType: 'user',
        resourceId: userId,
        metadata: { newRole: role },
      },
    });

    return updated;
  }

  async assignConsultant(clientId: string, consultantId: string, adminId: string, notes?: string) {
    const existing = await this.prisma.consultantAssignment.findUnique({
      where: { consultantId_clientId: { consultantId, clientId } },
    });
    if (existing) return existing;

    return this.prisma.consultantAssignment.create({
      data: {
        id: uuidv4(),
        consultantId,
        clientId,
        notes: notes || null,
      },
    });
  }

  async getAuditLogs(page = 1, limit = 100, userId?: string) {
    const skip = (page - 1) * limit;
    const where = userId ? { userId } : {};

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  async getStats() {
    const [totalUsers, clientCount, consultantCount, adminCount, protocolCount, uploadCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { role: 'client' } }),
        this.prisma.user.count({ where: { role: 'consultant' } }),
        this.prisma.user.count({ where: { role: 'admin' } }),
        this.prisma.protocol.count(),
        this.prisma.upload.count(),
      ]);

    return { totalUsers, clientCount, consultantCount, adminCount, protocolCount, uploadCount };
  }

  async getConsultants() {
    return this.prisma.user.findMany({
      where: { role: { in: ['consultant', 'admin', 'super_admin'] } },
      select: { id: true, name: true, email: true, role: true },
    });
  }

  async getClientNotes(clientId: string) {
    return this.prisma.adminNote.findMany({
      where: { clientId },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addClientNote(clientId: string, authorId: string, note: string) {
    return this.prisma.adminNote.create({
      data: {
        id: uuidv4(),
        clientId,
        authorId,
        note,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  }
}
