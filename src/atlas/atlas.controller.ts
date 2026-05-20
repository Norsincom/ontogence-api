import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AtlasService } from './atlas.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AtlasAnalysisType } from '@prisma/client';

class RunAnalysisDto {
  clientId!: string;
  analysisType!: AtlasAnalysisType;
  customPrompt?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
}

class AnnotateAnalysisDto {
  annotation!: string;
}

@ApiTags('atlas')
@ApiBearerAuth()
@Roles('super_admin')
@Controller('atlas')
export class AtlasController {
  constructor(private readonly atlasService: AtlasService) {}

  // Get all client summaries for the ONTID selector
  @Get('clients')
  getClientSummaries() {
    return this.atlasService.getClientSummaries();
  }

  // Get all recent analyses across all clients (Atlas dashboard)
  @Get('recent')
  getRecentAnalyses(
    @CurrentUser() user: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.atlasService.getRecentAnalyses(user.id, limit);
  }

  // Run a new analysis
  @Post('analyze')
  runAnalysis(
    @CurrentUser() user: { id: string },
    @Body() dto: RunAnalysisDto,
  ) {
    return this.atlasService.runAnalysis(user.id, dto.clientId, dto.analysisType, {
      customPrompt: dto.customPrompt,
      dateRangeStart: dto.dateRangeStart ? new Date(dto.dateRangeStart) : undefined,
      dateRangeEnd: dto.dateRangeEnd ? new Date(dto.dateRangeEnd) : undefined,
    });
  }

  // Get analysis history for a specific client
  @Get('client/:clientId/history')
  getAnalysisHistory(
    @CurrentUser() user: { id: string },
    @Param('clientId') clientId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.atlasService.getAnalysisHistory(clientId, user.id, page, limit);
  }

  // Get a single analysis by ID
  @Get(':id')
  getAnalysis(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.atlasService.getAnalysis(id, user.id);
  }

  // Add annotation to an analysis
  @Post(':id/annotate')
  annotateAnalysis(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AnnotateAnalysisDto,
  ) {
    return this.atlasService.annotateAnalysis(id, user.id, dto.annotation);
  }
}
