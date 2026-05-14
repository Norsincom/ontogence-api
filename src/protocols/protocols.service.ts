import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ProtocolsService {
  constructor(private prisma: PrismaService) {}

  private async hasVaultAccess(userId: string, userRole: string): Promise<boolean> {
    if (['admin', 'super_admin', 'consultant'].includes(userRole)) return true;
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'active' },
    });
    return !!sub;
  }

  async getMyProtocols(userId: string, userRole: string = 'user') {
    const hasAccess = await this.hasVaultAccess(userId, userRole);
    if (!hasAccess) return [];
    return this.prisma.protocol.findMany({
      where: { clientId: userId },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        deliveredBy: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getProtocol(protocolId: string, userId: string, userRole: string) {
    const protocol = await this.prisma.protocol.findUnique({
      where: { id: protocolId },
      include: {
        versions: { orderBy: { version: 'asc' } },
        deliveredBy: { select: { name: true, email: true } },
      },
    });
    if (!protocol) throw new NotFoundException('Protocol not found');
    if (protocol.clientId !== userId && !['admin', 'super_admin', 'consultant'].includes(userRole)) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        action: 'protocol_viewed',
        resourceType: 'protocol',
        resourceId: protocolId,
      },
    });

    return protocol;
  }

  async createProtocol(adminId: string, clientId: string, title: string, content: string) {
    const protocol = await this.prisma.protocol.create({
      data: {
        id: uuidv4(),
        clientId,
        deliveredById: adminId,
        title,
        status: 'draft',
        currentVersion: 1,
        updatedAt: new Date(),
      },
    });

    await this.prisma.protocolVersion.create({
      data: {
        id: uuidv4(),
        protocolId: protocol.id,
        version: 1,
        content,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'protocol_created',
        resourceType: 'protocol',
        resourceId: protocol.id,
        metadata: { clientId, title },
      },
    });

    return protocol;
  }

  async deliverProtocol(protocolId: string, adminId: string) {
    const protocol = await this.prisma.protocol.findUnique({ where: { id: protocolId } });
    if (!protocol) throw new NotFoundException('Protocol not found');

    const updated = await this.prisma.protocol.update({
      where: { id: protocolId },
      data: { status: 'delivered', deliveredAt: new Date(), updatedAt: new Date() },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId: protocol.clientId,
        protocolId,
        eventType: 'protocol_delivered',
        title: `Protocol Delivered: ${protocol.title}`,
        description: 'Your personalised protocol has been delivered.',
        occurredAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'protocol_delivered',
        resourceType: 'protocol',
        resourceId: protocolId,
      },
    });

    return updated;
  }

  async addVersion(protocolId: string, adminId: string, content: string, notes?: string) {
    const protocol = await this.prisma.protocol.findUnique({ where: { id: protocolId } });
    if (!protocol) throw new NotFoundException('Protocol not found');

    const newVersion = protocol.currentVersion + 1;

    await this.prisma.protocolVersion.create({
      data: {
        id: uuidv4(),
        protocolId,
        version: newVersion,
        content,
        notes: notes || null,
      },
    });

    return this.prisma.protocol.update({
      where: { id: protocolId },
      data: { currentVersion: newVersion, status: 'updated', updatedAt: new Date() },
    });
  }
}
