import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as PDFDocument from 'pdfkit';

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

  async createProtocol(
    adminId: string,
    clientId: string,
    title: string,
    content: string,
    adminRole?: string,
    adminName?: string,
  ) {
    const protocol = await this.prisma.protocol.create({
      data: {
        id: uuidv4(),
        clientId,
        deliveredById: adminId,
        title,
        status: 'draft',
        currentVersion: 1,
        updatedAt: new Date(),
        // Attribution
        createdByUserId: adminId,
        createdByRole: adminRole || 'admin',
        createdByName: adminName || null,
        updatedByUserId: adminId,
        updatedByRole: adminRole || 'admin',
        updatedByName: adminName || null,
      },
    });

    await this.prisma.protocolVersion.create({
      data: {
        id: uuidv4(),
        protocolId: protocol.id,
        version: 1,
        content,
        // Attribution snapshot on version
        createdByUserId: adminId,
        createdByRole: adminRole || 'admin',
        createdByName: adminName || null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'protocol_created',
        resourceType: 'protocol',
        resourceId: protocol.id,
        metadata: {
          clientId,
          title,
          createdByRole: adminRole || 'admin',
          createdByName: adminName || null,
        },
      },
    });

    return protocol;
  }

  async deliverProtocol(protocolId: string, adminId: string, adminRole?: string, adminName?: string) {
    const protocol = await this.prisma.protocol.findUnique({ where: { id: protocolId } });
    if (!protocol) throw new NotFoundException('Protocol not found');

    const updated = await this.prisma.protocol.update({
      where: { id: protocolId },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
        // Attribution
        updatedByUserId: adminId,
        updatedByRole: adminRole || 'admin',
        updatedByName: adminName || null,
      },
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
        // Attribution
        createdByUserId: adminId,
        createdByRole: adminRole || 'admin',
        createdByName: adminName || null,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'protocol_delivered',
        resourceType: 'protocol',
        resourceId: protocolId,
        metadata: {
          updatedByRole: adminRole || 'admin',
          updatedByName: adminName || null,
        },
      },
    });

    return updated;
  }

  async addVersion(
    protocolId: string,
    adminId: string,
    content: string,
    notes?: string,
    adminRole?: string,
    adminName?: string,
  ) {
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
        // Attribution snapshot
        createdByUserId: adminId,
        createdByRole: adminRole || 'admin',
        createdByName: adminName || null,
      },
    });

    return this.prisma.protocol.update({
      where: { id: protocolId },
      data: {
        currentVersion: newVersion,
        status: 'updated',
        updatedAt: new Date(),
        // Attribution
        updatedByUserId: adminId,
        updatedByRole: adminRole || 'admin',
        updatedByName: adminName || null,
      },
    });
  }

  /**
   * Generate a PDF for a protocol with the client ONTID embedded in the header and footer.
   * Returns a Buffer containing the PDF bytes.
   */
  async generateProtocolPdf(protocolId: string, requesterId: string, requesterRole: string): Promise<Buffer> {
    const protocol = await this.prisma.protocol.findUnique({
      where: { id: protocolId },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
        deliveredBy: { select: { name: true, email: true } },
      },
    });
    if (!protocol) throw new NotFoundException('Protocol not found');
    if (protocol.clientId !== requesterId && !['admin', 'super_admin', 'consultant'].includes(requesterRole)) {
      throw new ForbiddenException('Access denied');
    }

    const client = await this.prisma.user.findUnique({
      where: { id: protocol.clientId },
      select: { name: true, email: true, ontId: true },
    });

    const latestVersion = protocol.versions[0];
    const content = latestVersion?.content || '';
    const deliveredByName = protocol.deliveredBy?.name || 'Ontogence';
    const clientName = client?.name || 'Client';
    const clientOntId = client?.ontId || 'N/A';
    const deliveredAt = protocol.deliveredAt
      ? new Date(protocol.deliveredAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'Pending';

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header bar
      doc.rect(0, 0, doc.page.width, 80).fill('#0a1628');
      doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text('ONTOGENCE', 60, 28);
      doc.fillColor('#4ade80').fontSize(8).font('Helvetica').text('MECHANISM INTELLIGENCE PLATFORM', 60, 52);

      // ONTID badge top-right
      const ontIdX = doc.page.width - 210;
      doc.roundedRect(ontIdX, 18, 160, 44, 6).fill('#1e3a5f');
      doc.fillColor('#4ade80').fontSize(7).font('Helvetica-Bold').text('CLIENT IDENTITY', ontIdX + 10, 26);
      doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold').text(clientOntId, ontIdX + 10, 40);

      doc.moveDown(4);

      // Protocol title
      doc.fillColor('#0a1628').fontSize(22).font('Helvetica-Bold').text(protocol.title);
      doc.moveDown(0.5);

      // Metadata
      doc.fillColor('#6b7280').fontSize(9).font('Helvetica')
        .text(`Client: ${clientName}  ·  ONTID: ${clientOntId}  ·  Status: ${protocol.status.toUpperCase()}  ·  Delivered: ${deliveredAt}  ·  Prepared by: ${deliveredByName}`);
      doc.moveDown(0.3);

      // Divider
      doc.moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.moveDown(1);

      // Content
      doc.fillColor('#111827').fontSize(10.5).font('Helvetica').text(content, { align: 'left', lineGap: 4 });

      doc.moveDown(2);

      // Footer
      const footerY = doc.page.height - 60;
      doc.moveTo(60, footerY).lineTo(doc.page.width - 60, footerY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc.fillColor('#9ca3af').fontSize(8).font('Helvetica')
        .text(
          `Ontogence Mechanism Intelligence Platform  ·  ONTID: ${clientOntId}  ·  Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          60, footerY + 10,
          { align: 'center', width: doc.page.width - 120 }
        );

      doc.end();
    });
  }
}
