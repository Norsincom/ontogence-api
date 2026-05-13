import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MessagingService {
  constructor(private prisma: PrismaService) {}

  async getMyConversations(userId: string, role: string) {
    if (['admin', 'super_admin'].includes(role)) {
      return this.prisma.conversation.findMany({
        include: {
          client: { select: { id: true, name: true, email: true, avatarUrl: true } },
          staff: { select: { id: true, name: true, email: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { lastMessageAt: 'desc' },
      });
    }

    return this.prisma.conversation.findMany({
      where: { OR: [{ clientId: userId }, { staffId: userId }] },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        staff: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  }

  async getMessages(conversationId: string, userId: string, role: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.clientId !== userId && conv.staffId !== userId && !['admin', 'super_admin'].includes(role)) {
      throw new ForbiddenException('Access denied');
    }

    // Mark messages as read
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date(), status: 'read' },
    });

    return this.prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    body: string,
    role: string,
    attachmentKey?: string,
    attachmentUrl?: string,
    attachmentName?: string,
  ) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.clientId !== senderId && conv.staffId !== senderId && !['admin', 'super_admin'].includes(role)) {
      throw new ForbiddenException('Access denied');
    }

    const message = await this.prisma.message.create({
      data: {
        id: uuidv4(),
        conversationId,
        senderId,
        body,
        attachmentKey: attachmentKey || null,
        attachmentUrl: attachmentUrl || null,
        attachmentName: attachmentName || null,
      },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: senderId,
        action: 'message_sent',
        resourceType: 'conversation',
        resourceId: conversationId,
      },
    });

    return message;
  }

  async createConversation(clientId: string, staffId: string, subject?: string) {
    // Check if active conversation already exists
    const existing = await this.prisma.conversation.findFirst({
      where: { clientId, staffId, status: 'active' },
    });
    if (existing) return existing;

    const conv = await this.prisma.conversation.create({
      data: {
        id: uuidv4(),
        clientId,
        staffId,
        subject: subject || null,
        updatedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: clientId,
        action: 'conversation_created',
        resourceType: 'conversation',
        resourceId: conv.id,
      },
    });

    return conv;
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: { OR: [{ clientId: userId }, { staffId: userId }] },
      },
    });
    return { count };
  }

  /** Returns the super_admin user so clients can auto-create a conversation with them */
  async getAdminUser() {
    const admin = await this.prisma.user.findFirst({
      where: { role: 'super_admin' },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    return admin;
  }
}
