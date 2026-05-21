import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import { CreateIntakeLogDto } from './dto/create-intake-log.dto';
import { UpdateIntakeLogDto } from './dto/update-intake-log.dto';
import { QueryIntakeLogsDto } from './dto/query-intake-logs.dto';

@Injectable()
export class IntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(
    userId: string,
    createdById: string,
    dto: CreateIntakeLogDto,
    ipAddress?: string,
  ) {
    const log = await this.prisma.intakeLog.create({
      data: {
        userId,
        createdById,
        entryType: dto.entryType,
        name: dto.name,
        dose: dto.dose,
        unit: dto.unit,
        route: dto.route,
        notes: dto.notes,
        tags: dto.tags,
        eventAt: new Date(dto.eventAt),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: createdById,
        action: 'intake_log_created',
        resourceType: 'IntakeLog',
        resourceId: log.id,
        metadata: { targetUserId: userId, entryType: dto.entryType, name: dto.name },
        ipAddress,
      },
    });

    return log;
  }

  async getLogs(userId: string, query: QueryIntakeLogsDto) {
    const where: any = { userId };

    if (query.entryType) {
      where.entryType = query.entryType;
    }

    if (query.from || query.to) {
      where.eventAt = {};
      if (query.from) where.eventAt.gte = new Date(query.from);
      if (query.to) where.eventAt.lte = new Date(query.to);
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
        { tags: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      this.prisma.intakeLog.findMany({
        where,
        orderBy: { eventAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          createdBy: {
            select: { id: true, name: true, role: true, avatarUrl: true },
          },
          editHistory: {
            orderBy: { editedAt: 'desc' },
            take: 5,
            include: {
              editedBy: { select: { id: true, name: true, role: true } },
            },
          },
        },
      }),
      this.prisma.intakeLog.count({ where }),
    ]);

    return { logs, total };
  }

  async getLog(id: string, userId: string) {
    const log = await this.prisma.intakeLog.findFirst({
      where: { id, userId },
      include: {
        createdBy: {
          select: { id: true, name: true, role: true, avatarUrl: true },
        },
        editHistory: {
          orderBy: { editedAt: 'desc' },
          include: {
            editedBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    if (!log) throw new NotFoundException('Intake log not found');
    return log;
  }

  async updateLog(
    id: string,
    userId: string,
    editorId: string,
    dto: UpdateIntakeLogDto,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.intakeLog.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Intake log not found');

    // Record edit history for changed fields
    const editEntries: any[] = [];
    const fieldsToTrack = ['name', 'dose', 'unit', 'route', 'notes', 'tags', 'entryType', 'eventAt'] as const;

    for (const field of fieldsToTrack) {
      if (dto[field] !== undefined) {
        const oldVal = String(existing[field] ?? '');
        const newVal = field === 'eventAt' ? dto[field] : String(dto[field] ?? '');
        if (oldVal !== newVal) {
          editEntries.push({
            intakeLogId: id,
            editedById: editorId,
            fieldChanged: field,
            oldValue: oldVal,
            newValue: newVal,
          });
        }
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.intakeLog.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.entryType && { entryType: dto.entryType }),
          ...(dto.dose !== undefined && { dose: dto.dose }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          ...(dto.route !== undefined && { route: dto.route }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.tags !== undefined && { tags: dto.tags }),
          ...(dto.eventAt && { eventAt: new Date(dto.eventAt) }),
        },
      }),
      ...(editEntries.length > 0
        ? [this.prisma.intakeLogEdit.createMany({ data: editEntries })]
        : []),
    ]);

    await this.prisma.auditLog.create({
      data: {
        userId: editorId,
        action: 'intake_log_updated',
        resourceType: 'IntakeLog',
        resourceId: id,
        metadata: { targetUserId: userId, fieldsChanged: editEntries.map((e) => e.fieldChanged) },
        ipAddress,
      },
    });

    return updated;
  }

  async deleteLog(
    id: string,
    userId: string,
    deletedById: string,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.intakeLog.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Intake log not found');

    await this.prisma.intakeLog.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        userId: deletedById,
        action: 'intake_log_deleted',
        resourceType: 'IntakeLog',
        resourceId: id,
        metadata: { targetUserId: userId, entryType: existing.entryType, name: existing.name },
        ipAddress,
      },
    });

    return { success: true };
  }

  // ─── Admin methods (SUPER_ADMIN / admin can access any user's logs) ───────

  async adminGetLogs(targetUserId: string, query: QueryIntakeLogsDto) {
    return this.getLogs(targetUserId, query);
  }

  async adminCreateLog(
    targetUserId: string,
    adminId: string,
    dto: CreateIntakeLogDto,
    ipAddress?: string,
  ) {
    return this.createLog(targetUserId, adminId, dto, ipAddress);
  }

  async adminUpdateLog(
    id: string,
    targetUserId: string,
    adminId: string,
    dto: UpdateIntakeLogDto,
    ipAddress?: string,
  ) {
    return this.updateLog(id, targetUserId, adminId, dto, ipAddress);
  }

  async adminDeleteLog(
    id: string,
    targetUserId: string,
    adminId: string,
    ipAddress?: string,
  ) {
    return this.deleteLog(id, targetUserId, adminId, ipAddress);
  }
}
