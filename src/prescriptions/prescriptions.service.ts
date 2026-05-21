import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { v4 as uuidv4 } from 'uuid';

// ── Medication intelligence via LLM ──────────────────────────────────────────
interface MedInfo {
  medClass: string;
  indication: string;
  appearance: string; // JSON string: { color, shape, imprint, description }
  educationNote: string;
}

@Injectable()
export class PrescriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Client: create ──────────────────────────────────────────────────────────
  async create(userId: string, createdById: string, dto: CreatePrescriptionDto) {
    const id = uuidv4();
    const rx = await this.prisma.prescription.create({
      data: {
        id,
        userId,
        createdById,
        medicationName: dto.medicationName,
        strength: dto.strength,
        dose: dto.dose,
        frequency: dto.frequency,
        route: dto.route ?? 'oral',
        prescribingPhysician: dto.prescribingPhysician,
        pharmacy: dto.pharmacy,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        isActive: dto.isActive ?? true,
        notes: dto.notes,
      },
      include: { editHistory: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });

    // Enrich with LLM medication intelligence asynchronously (non-blocking)
    this.enrichMedicationInfo(rx.id, dto.medicationName, dto.strength).catch(() => {});

    return rx;
  }

  // ── Client: list ────────────────────────────────────────────────────────────
  async findAll(userId: string, filter?: { isActive?: boolean; search?: string }) {
    const where: any = { userId };
    if (filter?.isActive !== undefined) where.isActive = filter.isActive;
    if (filter?.search) {
      where.OR = [
        { medicationName: { contains: filter.search, mode: 'insensitive' } },
        { medClass: { contains: filter.search, mode: 'insensitive' } },
        { indication: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.prescription.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { editHistory: { orderBy: { createdAt: 'desc' }, take: 3 } },
    });
  }

  // ── Client: get one ─────────────────────────────────────────────────────────
  async findOne(id: string, userId: string) {
    const rx = await this.prisma.prescription.findFirst({
      where: { id, userId },
      include: {
        editHistory: {
          orderBy: { createdAt: 'desc' },
          include: { editor: { select: { id: true, name: true, role: true } } },
        },
      },
    });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  // ── Client: update ──────────────────────────────────────────────────────────
  async update(id: string, userId: string, editorId: string, dto: UpdatePrescriptionDto) {
    const rx = await this.prisma.prescription.findFirst({ where: { id, userId } });
    if (!rx) throw new NotFoundException('Prescription not found');

    // Save snapshot before update
    await this.prisma.prescriptionEdit.create({
      data: {
        id: uuidv4(),
        prescriptionId: id,
        editorId,
        changeNote: 'Updated',
        snapshotJson: JSON.stringify(rx),
      },
    });

    const updated = await this.prisma.prescription.update({
      where: { id },
      data: {
        ...(dto.medicationName !== undefined && { medicationName: dto.medicationName }),
        ...(dto.strength !== undefined && { strength: dto.strength }),
        ...(dto.dose !== undefined && { dose: dto.dose }),
        ...(dto.frequency !== undefined && { frequency: dto.frequency }),
        ...(dto.route !== undefined && { route: dto.route }),
        ...(dto.prescribingPhysician !== undefined && { prescribingPhysician: dto.prescribingPhysician }),
        ...(dto.pharmacy !== undefined && { pharmacy: dto.pharmacy }),
        ...(dto.startDate !== undefined && { startDate: dto.startDate ? new Date(dto.startDate) : null }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedAt: new Date(),
      },
      include: { editHistory: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });

    // Re-enrich if medication name changed
    if (dto.medicationName && dto.medicationName !== rx.medicationName) {
      this.enrichMedicationInfo(id, dto.medicationName, dto.strength ?? rx.strength ?? undefined).catch(() => {});
    }

    return updated;
  }

  // ── Client: delete ──────────────────────────────────────────────────────────
  async remove(id: string, userId: string) {
    const rx = await this.prisma.prescription.findFirst({ where: { id, userId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    await this.prisma.prescription.delete({ where: { id } });
    return { success: true };
  }

  // ── Admin: list for any user ─────────────────────────────────────────────────
  async adminFindAll(userId: string, filter?: { isActive?: boolean; search?: string }) {
    const where: any = { userId };
    if (filter?.isActive !== undefined) where.isActive = filter.isActive;
    if (filter?.search) {
      where.OR = [
        { medicationName: { contains: filter.search, mode: 'insensitive' } },
        { medClass: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.prescription.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: {
        editHistory: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { editor: { select: { id: true, name: true, role: true } } },
        },
        createdBy: { select: { id: true, name: true, role: true } },
      },
    });
  }

  // ── Admin: create for any user ───────────────────────────────────────────────
  async adminCreate(userId: string, adminId: string, dto: CreatePrescriptionDto) {
    return this.create(userId, adminId, dto);
  }

  // ── Admin: update for any user ───────────────────────────────────────────────
  async adminUpdate(id: string, userId: string, adminId: string, dto: UpdatePrescriptionDto) {
    const rx = await this.prisma.prescription.findFirst({ where: { id, userId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    return this.update(id, userId, adminId, dto);
  }

  // ── Admin: delete for any user ───────────────────────────────────────────────
  async adminRemove(id: string, userId: string) {
    const rx = await this.prisma.prescription.findFirst({ where: { id, userId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    await this.prisma.prescription.delete({ where: { id } });
    return { success: true };
  }

  // ── Re-enrich medication info on demand ──────────────────────────────────────
  async refreshMedInfo(id: string, userId: string) {
    const rx = await this.prisma.prescription.findFirst({ where: { id, userId } });
    if (!rx) throw new NotFoundException('Prescription not found');
    await this.enrichMedicationInfo(id, rx.medicationName, rx.strength ?? undefined);
    return this.prisma.prescription.findUnique({ where: { id } });
  }

  // ── LLM medication intelligence ──────────────────────────────────────────────
  private async enrichMedicationInfo(
    prescriptionId: string,
    medicationName: string,
    strength?: string,
  ): Promise<void> {
    const forgeUrl = process.env.BUILT_IN_FORGE_API_URL || 'https://forge.manus.ai';
    const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
    if (!forgeKey) return;

    const strengthStr = strength ? ` ${strength}` : '';
    const systemPrompt = `You are a clinical pharmacology reference assistant. Provide factual, educational medication information in structured JSON. 
CRITICAL SAFETY RULE: Do NOT provide prescribing instructions, dosage recommendations, or medical advice. 
Only provide: drug class, common indication, physical appearance description, and a brief educational note.
Always include a disclaimer that this is for identification/educational purposes only.`;

    const userMessage = `Provide structured information for: ${medicationName}${strengthStr}

Return ONLY valid JSON in this exact format:
{
  "medClass": "drug class/category (e.g., GLP-1/GIP receptor agonist, SSRI, ACE inhibitor)",
  "indication": "common clinical use in 1-2 sentences (educational only)",
  "appearance": {
    "color": "typical color(s) if known",
    "shape": "tablet/capsule/liquid/injection/patch/etc",
    "imprint": "common imprint codes if applicable, or 'varies by manufacturer'",
    "description": "brief physical description"
  },
  "educationNote": "1-2 sentence educational note about this medication class. Must end with: 'This information is for identification and educational purposes only — not medical advice.'"
}

If the medication is not recognized, return:
{
  "medClass": "Unknown",
  "indication": "Medication not found in reference database.",
  "appearance": { "color": "unknown", "shape": "unknown", "imprint": "unknown", "description": "No appearance data available." },
  "educationNote": "This information is for identification and educational purposes only — not medical advice."
}`;

    try {
      const response = await fetch(`${forgeUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${forgeKey}`,
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 800,
          temperature: 0.1,
        }),
      });

      if (!response.ok) return;

      const result = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const raw = result.choices[0]?.message?.content || '';
      // Extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const info = JSON.parse(jsonMatch[0]) as {
        medClass?: string;
        indication?: string;
        appearance?: object;
        educationNote?: string;
      };

      await this.prisma.prescription.update({
        where: { id: prescriptionId },
        data: {
          medClass: info.medClass || null,
          indication: info.indication || null,
          appearance: info.appearance ? JSON.stringify(info.appearance) : null,
          educationNote: info.educationNote || null,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Non-blocking — enrichment failure should never break the create/update flow
    }
  }
}
