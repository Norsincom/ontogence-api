import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async getMyConversations(userId: string, role: string) {
    if (['admin', 'super_admin'].includes(role)) {
      return this.prisma.conversation.findMany({
        include: {
          client: { select: { id: true, name: true, email: true, avatarUrl: true, ontId: true } },
          staff: { select: { id: true, name: true, email: true, ontId: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { lastMessageAt: 'desc' },
      });
    }

    return this.prisma.conversation.findMany({
      where: { OR: [{ clientId: userId }, { staffId: userId }] },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true, ontId: true } },
        staff: { select: { id: true, name: true, email: true, ontId: true } },
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
    senderName?: string,
  ) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        client: { select: { id: true, name: true, email: true, ontId: true } },
        staff: { select: { id: true, name: true, email: true, ontId: true } },
      },
    });
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
        // Attribution snapshot — immutable at send time
        senderRole: role,
        senderName: senderName || null,
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
        metadata: {
          senderRole: role,
          senderName: senderName || null,
        },
      },
    });

    // ── Email notification (fire-and-forget, never blocks the response) ───────
    this.sendMessageNotificationEmail(conv as any, senderId, senderName || 'Ontogence').catch((err) => {
      this.logger.error('Failed to send message notification email', err);
    });

    return message;
  }

  /**
   * Sends an email notification to the recipient of a new message.
   * - Client sends → notify staff/super_admin
   * - Staff/admin sends → notify client
   * Never includes message body (HIPAA-safe).
   */
  private async sendMessageNotificationEmail(conv: any, senderId: string, senderName: string): Promise<void> {
    const isClientSending = conv.clientId === senderId;
    const recipient = isClientSending ? conv.staff : conv.client;
    if (!recipient?.email) return;
    const recipientName = recipient.name || 'there';
    const timestamp = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    if (isClientSending) {
      await this.emailService.sendNewMessageToAdmin(
        recipient.email,
        recipientName,
        senderName,
        conv.client?.name || 'A client',
        timestamp,
      );
    } else {
      await this.emailService.sendNewMessage(recipient.email, recipientName, senderName);
    }
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: senderId,
        action: 'notification_sent',
        resourceType: 'conversation',
        resourceId: conv.id,
        metadata: { type: 'email_notification', recipientEmail: recipient.email, recipientName, timestamp },
      },
    });
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
      select: { id: true, name: true, email: true, avatarUrl: true, ontId: true },
    });
    return admin;
  }

  /**
   * Search all non-admin users by name, email, or ONTID.
   * Used by the super_admin "New Message" modal to select a recipient.
   */
  async searchClients(query: string) {
    const q = query?.trim() || '';
    const where = q
      ? {
          role: { not: 'super_admin' as any },
          OR: [
            { name: { contains: q, mode: 'insensitive' as any } },
            { email: { contains: q, mode: 'insensitive' as any } },
            { ontId: { contains: q, mode: 'insensitive' as any } },
          ],
        }
      : { role: { not: 'super_admin' as any } };
    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, avatarUrl: true, ontId: true, role: true },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });
  }
}
