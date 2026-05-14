import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MonitoringService {
  constructor(private prisma: PrismaService) {}

  async getBiomarkers(userId: string, panel?: string) {
    return this.prisma.biomarkerLog.findMany({
      where: { userId, ...(panel ? { panel } : {}) },
      orderBy: { loggedAt: 'desc' },
    });
  }

  async addBiomarker(
    userId: string,
    data: {
      panel: string; marker: string; value: number; unit: string;
      referenceMin?: number; referenceMax?: number; loggedAt: string; source?: string; notes?: string;
    },
    createdByUserId?: string,
    createdByRole?: string,
    createdByName?: string,
  ) {
    const isAbnormal =
      (data.referenceMin !== undefined && data.value < data.referenceMin) ||
      (data.referenceMax !== undefined && data.value > data.referenceMax);

    return this.prisma.biomarkerLog.create({
      data: {
        id: uuidv4(),
        userId,
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
        // Attribution
        createdByUserId: createdByUserId || userId,
        createdByRole: createdByRole || 'client',
        createdByName: createdByName || null,
      },
    });
  }

  async getSymptoms(userId: string) {
    return this.prisma.symptomLog.findMany({
      where: { userId },
      orderBy: { loggedAt: 'desc' },
      take: 100,
    });
  }

  async addSymptom(userId: string, data: {
    symptom: string; severity: number; notes?: string; loggedAt: string;
  }) {
    return this.prisma.symptomLog.create({
      data: {
        id: uuidv4(),
        userId,
        symptom: data.symptom,
        severity: data.severity,
        notes: data.notes ?? null,
        loggedAt: new Date(data.loggedAt),
      },
    });
  }

  async getTimeline(userId: string) {
    return this.prisma.timelineEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      include: { protocol: { select: { title: true } } },
    });
  }

  async getDashboardSummary(userId: string) {
    const [biomarkers, symptoms, timeline, protocols] = await Promise.all([
      this.prisma.biomarkerLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' }, take: 20 }),
      this.prisma.symptomLog.findMany({ where: { userId }, orderBy: { loggedAt: 'desc' }, take: 10 }),
      this.prisma.timelineEvent.findMany({ where: { userId }, orderBy: { occurredAt: 'desc' }, take: 5 }),
      this.prisma.protocol.findMany({ where: { clientId: userId }, orderBy: { updatedAt: 'desc' } }),
    ]);

    const abnormalCount = biomarkers.filter((b) => b.isAbnormal).length;
    const activeProtocol = protocols.find((p) => p.status === 'delivered' || p.status === 'updated');

    return {
      biomarkerCount: biomarkers.length,
      abnormalCount,
      recentBiomarkers: biomarkers.slice(0, 5),
      recentSymptoms: symptoms.slice(0, 5),
      recentTimeline: timeline,
      activeProtocol,
      protocolCount: protocols.length,
    };
  }
}
