import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AtlasAnalysisType, AtlasStatus } from '@prisma/client';

// ─── Analysis type prompts ────────────────────────────────────────────────────

const ANALYSIS_PROMPTS: Record<AtlasAnalysisType, string> = {
  BIOMARKER_TREND: `You are Atlas, an expert biomedical data analyst for Ontogence, a precision health platform.
Analyze the provided biomarker data for this client. Your task:
1. Identify trends, patterns, and anomalies across all biomarker panels
2. Flag any values outside reference ranges with clinical significance
3. Note trajectory (improving, declining, stable) for each key marker
4. Identify correlations between different biomarker panels
5. Provide a structured clinical summary with actionable observations
Format your response with clear sections: Executive Summary, Panel-by-Panel Analysis, Key Findings, Trends & Correlations, and Recommendations for Review.`,

  PROTOCOL_EFFICACY: `You are Atlas, an expert biomedical protocol analyst for Ontogence.
Analyze the client's protocol history and biomarker data to assess protocol efficacy. Your task:
1. Review all delivered protocols and their timelines
2. Correlate protocol interventions with biomarker changes
3. Identify which protocol elements appear to be driving positive outcomes
4. Flag any areas where protocols may need adjustment
5. Assess overall protocol adherence indicators
Format your response with: Protocol Timeline, Efficacy Assessment per Protocol, Biomarker Response Analysis, and Clinical Recommendations.`,

  INTAKE_PATTERN: `You are Atlas, an expert nutritional and lifestyle analyst for Ontogence.
Analyze the client's intake log data to identify patterns and insights. Your task:
1. Identify dietary and supplement patterns
2. Correlate intake timing with symptom logs and biomarker data where available
3. Flag any potential interactions or concerns (medication/supplement combinations)
4. Identify gaps in nutritional tracking
5. Note adherence patterns and consistency
Format your response with: Intake Pattern Summary, Supplement & Medication Analysis, Dietary Patterns, Potential Interactions, and Lifestyle Observations.`,

  VAULT_SUMMARY: `You are Atlas, an expert medical records analyst for Ontogence.
Analyze the client's uploaded medical vault documents and records. Your task:
1. Summarize the types and recency of medical records on file
2. Identify any gaps in medical documentation
3. Note key findings from available records by category
4. Flag any records that may require follow-up or clinical attention
5. Provide a comprehensive medical records overview
Format your response with: Records Inventory, Key Findings by Category, Documentation Gaps, and Priority Items for Review.`,

  LONGITUDINAL_HEALTH: `You are Atlas, a longitudinal health intelligence analyst for Ontogence.
Perform a comprehensive longitudinal health analysis for this client. Your task:
1. Synthesize ALL available data: biomarkers, protocols, intake logs, symptoms, vault records
2. Identify the client's health trajectory over time
3. Highlight significant health events and turning points
4. Assess overall health optimization progress
5. Identify the most impactful interventions and areas for improvement
Format your response with: Longitudinal Overview, Health Trajectory Analysis, Key Milestones, Data-Driven Insights, and Strategic Recommendations.`,

  SYMPTOM_CORRELATION: `You are Atlas, a symptom and biomarker correlation specialist for Ontogence.
Analyze symptom logs and correlate them with biomarker data and intake patterns. Your task:
1. Map symptom frequency and severity over time
2. Identify correlations between symptoms and biomarker values
3. Correlate symptoms with intake patterns (foods, supplements, medications)
4. Identify potential triggers and relieving factors
5. Assess symptom burden and quality of life indicators
Format your response with: Symptom Profile, Biomarker Correlations, Intake Correlations, Trigger Analysis, and Clinical Observations.`,

  CUSTOM: `You are Atlas, a biomedical intelligence analyst for Ontogence.
Analyze the provided client data according to the custom analysis request below.
Be thorough, clinically precise, and evidence-based in your analysis.
Format your response clearly with appropriate sections based on the analysis requested.`,
};

// ─── Atlas Service ─────────────────────────────────────────────────────────────

@Injectable()
export class AtlasService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Aggregate all client data for analysis ──────────────────────────────────
  private async aggregateClientData(
    clientId: string,
    dateRangeStart?: Date,
    dateRangeEnd?: Date,
  ) {
    const dateFilter =
      dateRangeStart || dateRangeEnd
        ? {
            gte: dateRangeStart,
            lte: dateRangeEnd,
          }
        : undefined;

    const [
      client,
      profile,
      biomarkers,
      protocols,
      intakeLogs,
      symptomLogs,
      uploads,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, email: true, ontId: true, createdAt: true },
      }),
      this.prisma.clientProfile.findUnique({
        where: { userId: clientId },
        select: {
          dateOfBirth: true,
          biologicalAge: true,
          hrvScore: true,
          inflammationStatus: true,
          healthGoals: true,
          medicalHistory: true,
          currentMeds: true,
          allergies: true,
        },
      }),
      this.prisma.biomarkerLog.findMany({
        where: {
          userId: clientId,
          ...(dateFilter ? { loggedAt: dateFilter } : {}),
        },
        orderBy: { loggedAt: 'desc' },
        take: 200,
        select: {
          panel: true,
          marker: true,
          value: true,
          unit: true,
          referenceMin: true,
          referenceMax: true,
          isAbnormal: true,
          loggedAt: true,
          source: true,
          notes: true,
        },
      }),
      this.prisma.protocol.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          versions: {
            orderBy: { version: 'desc' },
            take: 1,
            select: { version: true, content: true, createdAt: true },
          },
        },
      }),
      this.prisma.intakeLog.findMany({
        where: {
          userId: clientId,
          ...(dateFilter ? { eventAt: dateFilter } : {}),
        },
        orderBy: { eventAt: 'desc' },
        take: 200,
        select: {
          entryType: true,
          name: true,
          dose: true,
          unit: true,
          route: true,
          notes: true,
          tags: true,
          eventAt: true,
        },
      }),
      this.prisma.symptomLog.findMany({
        where: {
          userId: clientId,
          ...(dateFilter ? { loggedAt: dateFilter } : {}),
        },
        orderBy: { loggedAt: 'desc' },
        take: 100,
        select: {
          symptom: true,
          severity: true,
          notes: true,
          loggedAt: true,
        },
      }),
      this.prisma.upload.findMany({
        where: { userId: clientId, archivedAt: null },
        orderBy: { uploadedAt: 'desc' },
        take: 100,
        select: {
          category: true,
          originalName: true,
          uploadedAt: true,
          notes: true,
        },
      }),
    ]);

    return {
      client,
      profile,
      biomarkers,
      protocols: protocols.map((p) => ({
        title: p.title,
        status: p.status,
        deliveredAt: p.deliveredAt,
        createdAt: p.createdAt,
        latestVersion: p.versions[0] || null,
      })),
      intakeLogs,
      symptomLogs,
      uploads: uploads.map((u) => ({
        category: u.category,
        name: u.originalName,
        uploadedAt: u.uploadedAt,
        notes: u.notes,
      })),
      stats: {
        biomarkerCount: biomarkers.length,
        abnormalBiomarkers: biomarkers.filter((b) => b.isAbnormal).length,
        protocolCount: protocols.length,
        intakeLogCount: intakeLogs.length,
        symptomLogCount: symptomLogs.length,
        vaultFileCount: uploads.length,
      },
    };
  }

  // ── Build the LLM prompt ────────────────────────────────────────────────────
  private buildPrompt(
    analysisType: AtlasAnalysisType,
    data: Awaited<ReturnType<typeof this.aggregateClientData>>,
    customPrompt?: string,
  ): string {
    const systemPrompt = ANALYSIS_PROMPTS[analysisType];
    const dataContext = JSON.stringify(data, null, 2);

    const userMessage =
      analysisType === 'CUSTOM' && customPrompt
        ? `Custom Analysis Request: ${customPrompt}\n\nClient Data:\n${dataContext}`
        : `Please analyze the following client data:\n\n${dataContext}`;

    return JSON.stringify({ systemPrompt, userMessage });
  }

  // ── Call the LLM ────────────────────────────────────────────────────────────
  private async callLLM(
    systemPrompt: string,
    userMessage: string,
  ): Promise<{ content: string; model: string; tokensUsed: number }> {
    const forgeUrl = process.env.BUILT_IN_FORGE_API_URL || 'https://forge.manus.ai';
    const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;

    if (!forgeKey) {
      throw new Error('BUILT_IN_FORGE_API_KEY is not configured');
    }

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
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error ${response.status}: ${error}`);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { total_tokens: number };
    };

    return {
      content: result.choices[0]?.message?.content || '',
      model: result.model || 'claude-3-5-sonnet-20241022',
      tokensUsed: result.usage?.total_tokens || 0,
    };
  }

  // ── Run an analysis ─────────────────────────────────────────────────────────
  async runAnalysis(
    requestedById: string,
    clientId: string,
    analysisType: AtlasAnalysisType,
    options?: {
      customPrompt?: string;
      dateRangeStart?: Date;
      dateRangeEnd?: Date;
    },
  ) {
    // Verify client exists
    const client = await this.prisma.user.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');

    // Create analysis record in RUNNING state
    const analysis = await this.prisma.atlasAnalysis.create({
      data: {
        clientId,
        requestedById,
        analysisType,
        customPrompt: options?.customPrompt,
        dateRangeStart: options?.dateRangeStart,
        dateRangeEnd: options?.dateRangeEnd,
        status: AtlasStatus.RUNNING,
      },
    });

    const startTime = Date.now();

    try {
      // Aggregate data
      const data = await this.aggregateClientData(
        clientId,
        options?.dateRangeStart,
        options?.dateRangeEnd,
      );

      // Build prompt
      const promptData = JSON.parse(
        this.buildPrompt(analysisType, data, options?.customPrompt),
      ) as { systemPrompt: string; userMessage: string };

      // Call LLM
      const llmResult = await this.callLLM(
        promptData.systemPrompt,
        promptData.userMessage,
      );

      const processingMs = Date.now() - startTime;

      // Update analysis with result
      const completed = await this.prisma.atlasAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: AtlasStatus.COMPLETED,
          result: llmResult.content,
          modelUsed: llmResult.model,
          tokensUsed: llmResult.tokensUsed,
          processingMs,
          completedAt: new Date(),
          dataSnapshot: data.stats as object,
        },
        include: {
          client: { select: { id: true, name: true, ontId: true } },
          requestedBy: { select: { id: true, name: true, role: true } },
        },
      });

      // Audit log
      await this.prisma.auditLog.create({
        data: {
          userId: requestedById,
          action: 'settings_changed' as any, // closest available; atlas_reviewed added to enum in future migration
          resourceType: 'atlas_analysis',
          resourceId: analysis.id,
          metadata: {
            clientId,
            analysisType,
            processingMs,
            tokensUsed: llmResult.tokensUsed,
          },
        },
      });

      return completed;
    } catch (error) {
      // Update analysis with failure
      await this.prisma.atlasAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: AtlasStatus.FAILED,
          errorMessage: (error as Error).message,
          processingMs: Date.now() - startTime,
        },
      });
      throw error;
    }
  }

  // ── Get analysis history for a client ──────────────────────────────────────
  async getAnalysisHistory(
    clientId: string,
    requestedById: string,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const [analyses, total] = await Promise.all([
      this.prisma.atlasAnalysis.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          requestedBy: { select: { id: true, name: true, role: true } },
          reviewHistory: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            include: {
              reviewedBy: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.atlasAnalysis.count({ where: { clientId } }),
    ]);

    // Log view action
    await this.prisma.atlasReviewHistory.create({
      data: {
        analysisId: analyses[0]?.id || '',
        reviewedById: requestedById,
        action: 'viewed_history',
      },
    }).catch(() => {}); // Non-critical

    return { analyses, total, page, limit };
  }

  // ── Get a single analysis ───────────────────────────────────────────────────
  async getAnalysis(id: string, reviewedById: string) {
    const analysis = await this.prisma.atlasAnalysis.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, ontId: true, email: true } },
        requestedBy: { select: { id: true, name: true, role: true } },
        reviewHistory: {
          orderBy: { createdAt: 'desc' },
          include: {
            reviewedBy: { select: { id: true, name: true, role: true } },
          },
        },
      },
    });

    if (!analysis) throw new NotFoundException('Analysis not found');

    // Log view
    await this.prisma.atlasReviewHistory.create({
      data: {
        analysisId: id,
        reviewedById,
        action: 'viewed',
      },
    });

    return analysis;
  }

  // ── Add annotation to an analysis ──────────────────────────────────────────
  async annotateAnalysis(id: string, reviewedById: string, annotation: string) {
    const analysis = await this.prisma.atlasAnalysis.findUnique({ where: { id } });
    if (!analysis) throw new NotFoundException('Analysis not found');

    return this.prisma.atlasReviewHistory.create({
      data: {
        analysisId: id,
        reviewedById,
        action: 'annotated',
        annotation,
      },
      include: {
        reviewedBy: { select: { id: true, name: true, role: true } },
      },
    });
  }

  // ── Get all recent analyses across all clients (for Atlas dashboard) ────────
  async getRecentAnalyses(requestedById: string, limit = 50) {
    return this.prisma.atlasAnalysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        client: { select: { id: true, name: true, ontId: true } },
        requestedBy: { select: { id: true, name: true, role: true } },
      },
    });
  }

  // ── Get all clients with their data stats (for ONTID selector) ─────────────
  async getClientSummaries() {
    const clients = await this.prisma.user.findMany({
      where: { role: 'client' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        ontId: true,
        avatarUrl: true,
        createdAt: true,
        _count: {
          select: {
            biomarkerLogs: true,
            intakeLogs: true,
            uploads: true,
            protocols: true,
            atlasAnalysesAsClient: true,
          },
        },
      },
    });

    return clients;
  }
}
