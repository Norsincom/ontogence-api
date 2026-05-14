import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@prisma/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { JwtService } from '@nestjs/jwt';

const BUCKET = 'vault';

@Injectable()
export class AdminService {
  private supabase: SupabaseClient;

  constructor(private prisma: PrismaService, private jwtService: JwtService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  // ── User listing ──────────────────────────────────────────────────────────
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
        include: {
          profile: true,
          _count: {
            select: { protocols: true, uploads: true, biomarkerLogs: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  // ── Shallow user (existing endpoint) ─────────────────────────────────────
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

  // ── Deep client profile (new) ─────────────────────────────────────────────
  async getClientProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        protocols: {
          include: {
            versions: { orderBy: { version: 'asc' } },
            deliveredBy: { select: { id: true, name: true, email: true, role: true } },
          },
          orderBy: { updatedAt: 'desc' },
        },
        uploads: {
          where: { archivedAt: null },
          orderBy: { uploadedAt: 'desc' },
        },
        biomarkerLogs: { orderBy: { loggedAt: 'desc' } },
        timelineEvents: {
          orderBy: { occurredAt: 'desc' },
          include: { protocol: { select: { id: true, title: true } } },
        },
        clientAssignments: {
          include: {
            consultant: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        adminNotesAsClient: {
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
        clientConversations: {
          include: {
            messages: {
              orderBy: { sentAt: 'desc' },
              take: 50,
              include: { sender: { select: { id: true, name: true, role: true } } },
            },
            staff: { select: { id: true, name: true, email: true, role: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Fetch audit logs for this user
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { OR: [{ userId }, { resourceId: userId }] },
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return { ...user, auditLogs };
  }

  // ── Update client profile fields ──────────────────────────────────────────
  async updateClientProfile(
    clientId: string,
    adminId: string,
    adminRole: string,
    data: {
      name?: string;
      dateOfBirth?: string;
      biologicalSex?: string;
      height?: number;
      weight?: number;
      primaryGoal?: string;
      medicalHistory?: string;
    },
  ) {
    const updates: any = {};
    if (data.name) {
      await this.prisma.user.update({ where: { id: clientId }, data: { name: data.name } });
    }

    const profileData: any = {};
    if (data.dateOfBirth !== undefined) profileData.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    if (data.biologicalSex !== undefined) profileData.biologicalSex = data.biologicalSex;
    if (data.height !== undefined) profileData.height = data.height;
    if (data.weight !== undefined) profileData.weight = data.weight;
    if (data.primaryGoal !== undefined) profileData.primaryGoal = data.primaryGoal;
    if (data.medicalHistory !== undefined) profileData.medicalHistory = data.medicalHistory;

    if (Object.keys(profileData).length > 0) {
      await this.prisma.clientProfile.upsert({
        where: { userId: clientId },
        update: profileData,
        create: { id: uuidv4(), userId: clientId, ...profileData },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_profile_update',
        resourceType: 'user',
        resourceId: clientId,
        metadata: { updatedFields: Object.keys(data), adminRole },
      },
    });

    return { success: true };
  }

  // ── Admin upload: get signed upload URL for a client ─────────────────────
  async getAdminUploadUrl(
    adminId: string,
    clientId: string,
    fileName: string,
    mimeType: string,
    category: string,
  ) {
    const ext = fileName.split('.').pop() || 'bin';
    const storageKey = `${clientId}/${category}/${uuidv4()}.${ext}`;

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(storageKey);

    if (error) throw new Error(`Storage error: ${error.message}`);

    return { uploadUrl: data.signedUrl, storageKey, token: data.token };
  }

  // ── Admin confirm upload for a client ────────────────────────────────────
  async adminConfirmUpload(
    adminId: string,
    adminRole: string,
    adminName: string,
    clientId: string,
    storageKey: string,
    originalName: string,
    mimeType: string,
    sizeBytes: number,
    category: string,
    notes?: string,
  ) {
    const { data } = await this.supabase.storage.from(BUCKET).getPublicUrl(storageKey);
    const storageUrl = data.publicUrl;
    const crypto = await import('crypto');
    const sha256Hash = crypto.createHash('sha256').update(storageKey + Date.now()).digest('hex');

    const upload = await this.prisma.upload.create({
      data: {
        id: uuidv4(),
        userId: clientId,
        fileName: storageKey.split('/').pop() || originalName,
        originalName,
        mimeType,
        sizeBytes,
        category: category as any,
        storageKey,
        storageUrl,
        sha256Hash,
        notes: notes || null,
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_file_upload',
        resourceType: 'upload',
        resourceId: upload.id,
        metadata: { clientId, category, fileName: originalName, adminRole },
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId: clientId,
        eventType: 'file_uploaded',
        title: `File Uploaded: ${originalName}`,
        description: `Uploaded by ${adminName} (${adminRole})`,
        occurredAt: new Date(),
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    return upload;
  }

  // ── Admin: get download URL for any client file ───────────────────────────
  async adminGetDownloadUrl(fileId: string) {
    const file = await this.prisma.upload.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    const { data, error } = await this.supabase.storage
      .from(BUCKET)
      .createSignedUrl(file.storageKey, 3600);

    if (error) throw new Error(`Storage error: ${error.message}`);
    return { url: data.signedUrl, file };
  }

  // ── Admin: archive (soft-delete) any client file ─────────────────────────
  async adminArchiveFile(fileId: string, adminId: string) {
    const file = await this.prisma.upload.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    await this.prisma.upload.update({
      where: { id: fileId },
      data: { archivedAt: new Date(), updatedByUserId: adminId, updatedByRole: 'super_admin' },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_file_archived',
        resourceType: 'upload',
        resourceId: fileId,
        metadata: { clientId: file.userId },
      },
    });

    return { success: true };
  }

  // ── Admin: create protocol for a client ──────────────────────────────────
  async adminCreateProtocol(
    adminId: string,
    adminRole: string,
    adminName: string,
    clientId: string,
    title: string,
    content: string,
    category?: string,
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
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
        updatedByUserId: adminId,
        updatedByRole: adminRole,
        updatedByName: adminName,
      },
    });

    await this.prisma.protocolVersion.create({
      data: {
        id: uuidv4(),
        protocolId: protocol.id,
        version: 1,
        content,
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_protocol_created',
        resourceType: 'protocol',
        resourceId: protocol.id,
        metadata: { clientId, title, adminRole },
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId: clientId,
        protocolId: protocol.id,
        eventType: 'protocol_created',
        title: `Protocol Created: ${title}`,
        description: `Created by ${adminName} (${adminRole})`,
        occurredAt: new Date(),
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    return protocol;
  }

  // ── Admin: update protocol ────────────────────────────────────────────────
  async adminUpdateProtocol(
    adminId: string,
    adminRole: string,
    adminName: string,
    protocolId: string,
    updates: { title?: string; content?: string; status?: string },
  ) {
    const protocol = await this.prisma.protocol.findUnique({ where: { id: protocolId } });
    if (!protocol) throw new NotFoundException('Protocol not found');

    const data: any = {
      updatedAt: new Date(),
      updatedByUserId: adminId,
      updatedByRole: adminRole,
      updatedByName: adminName,
    };
    if (updates.title) data.title = updates.title;
    if (updates.status) data.status = updates.status;

    const updated = await this.prisma.protocol.update({ where: { id: protocolId }, data });

    if (updates.content) {
      const newVersion = protocol.currentVersion + 1;
      await this.prisma.protocolVersion.create({
        data: {
          id: uuidv4(),
          protocolId,
          version: newVersion,
          content: updates.content,
          createdByUserId: adminId,
          createdByRole: adminRole,
          createdByName: adminName,
        },
      });
      await this.prisma.protocol.update({
        where: { id: protocolId },
        data: { currentVersion: newVersion },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_protocol_updated',
        resourceType: 'protocol',
        resourceId: protocolId,
        metadata: { updatedFields: Object.keys(updates), adminRole },
      },
    });

    return updated;
  }

  // ── Admin: deliver protocol ───────────────────────────────────────────────
  async adminDeliverProtocol(adminId: string, adminRole: string, adminName: string, protocolId: string) {
    const protocol = await this.prisma.protocol.findUnique({ where: { id: protocolId } });
    if (!protocol) throw new NotFoundException('Protocol not found');

    const updated = await this.prisma.protocol.update({
      where: { id: protocolId },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
        updatedByUserId: adminId,
        updatedByRole: adminRole,
        updatedByName: adminName,
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId: protocol.clientId,
        protocolId,
        eventType: 'protocol_delivered',
        title: `Protocol Delivered: ${protocol.title}`,
        description: `Delivered by ${adminName} (${adminRole})`,
        occurredAt: new Date(),
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_protocol_delivered',
        resourceType: 'protocol',
        resourceId: protocolId,
        metadata: { clientId: protocol.clientId, adminRole },
      },
    });

    return updated;
  }

  // ── Admin: add biomarker log for a client ─────────────────────────────────
  async adminAddBiomarker(
    adminId: string,
    adminRole: string,
    adminName: string,
    clientId: string,
    data: {
      panel: string;
      marker: string;
      value: number;
      unit: string;
      referenceMin?: number;
      referenceMax?: number;
      loggedAt: string;
      source?: string;
      notes?: string;
    },
  ) {
    const isAbnormal =
      (data.referenceMin !== undefined && data.value < data.referenceMin) ||
      (data.referenceMax !== undefined && data.value > data.referenceMax);

    const log = await this.prisma.biomarkerLog.create({
      data: {
        id: uuidv4(),
        userId: clientId,
        panel: data.panel,
        marker: data.marker,
        value: data.value,
        unit: data.unit,
        referenceMin: data.referenceMin ?? null,
        referenceMax: data.referenceMax ?? null,
        isAbnormal,
        loggedAt: new Date(data.loggedAt),
        source: data.source ?? null,
        notes: data.notes ?? null,
        createdByUserId: adminId,
        createdByRole: adminRole,
        createdByName: adminName,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_biomarker_added',
        resourceType: 'biomarker_log',
        resourceId: log.id,
        metadata: { clientId, panel: data.panel, marker: data.marker, adminRole },
      },
    });

    return log;
  }

  // ── Admin: delete biomarker log ───────────────────────────────────────────
  async adminDeleteBiomarker(adminId: string, logId: string) {
    const log = await this.prisma.biomarkerLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('Biomarker log not found');
    await this.prisma.biomarkerLog.delete({ where: { id: logId } });
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_biomarker_deleted',
        resourceType: 'biomarker_log',
        resourceId: logId,
        metadata: { clientId: log.userId },
      },
    });
    return { success: true };
  }

  // ── Role / assignment management ──────────────────────────────────────────
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

    const assignment = await this.prisma.consultantAssignment.create({
      data: { id: uuidv4(), consultantId, clientId, notes: notes || null },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'consultant_assigned',
        resourceType: 'user',
        resourceId: clientId,
        metadata: { consultantId },
      },
    });

    return assignment;
  }

  async removeAssignment(assignmentId: string, adminId: string) {
    const assignment = await this.prisma.consultantAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    await this.prisma.consultantAssignment.delete({ where: { id: assignmentId } });
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'consultant_unassigned',
        resourceType: 'user',
        resourceId: assignment.clientId,
        metadata: { consultantId: assignment.consultantId },
      },
    });
    return { success: true };
  }

  // ── Audit logs ────────────────────────────────────────────────────────────
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

  // ── Admin notes ───────────────────────────────────────────────────────────
  async getClientNotes(clientId: string) {
    return this.prisma.adminNote.findMany({
      where: { clientId },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addClientNote(clientId: string, authorId: string, note: string) {
    return this.prisma.adminNote.create({
      data: { id: uuidv4(), clientId, authorId, note },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
  }

  async deleteClientNote(noteId: string, adminId: string) {
    const note = await this.prisma.adminNote.findUnique({ where: { id: noteId } });
    if (!note) throw new NotFoundException('Note not found');
    await this.prisma.adminNote.delete({ where: { id: noteId } });
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_note_deleted',
        resourceType: 'admin_note',
        resourceId: noteId,
        metadata: { clientId: note.clientId },
      },
    });
    return { success: true };
  }

  // ── Impersonation token ───────────────────────────────────────────────────
  /**
   * Generates a short-lived JWT that the frontend stores in sessionStorage.
   * The frontend reads this token to render the impersonation banner and
   * passes it as a header so the API can resolve the impersonated user.
   * NOTE: This does NOT create a real Clerk session — it is a read-only
   * view token used to render the client's UI perspective.
   */
  async generateImpersonationToken(adminId: string, clientId: string) {
    const client = await this.prisma.user.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    const payload = {
      type: 'impersonation',
      adminId,
      clientId,
      clientEmail: client.email,
      clientName: client.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
    };

    const token = this.jwtService.sign(payload, { secret: process.env.JWT_SECRET, expiresIn: '1h' });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId: adminId,
        action: 'admin_impersonation_started',
        resourceType: 'user',
        resourceId: clientId,
        metadata: { clientEmail: client.email },
      },
    });

    return { token, client: { id: client.id, name: client.name, email: client.email } };
  }
}
