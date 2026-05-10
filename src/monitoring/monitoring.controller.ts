import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MonitoringService } from './monitoring.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('monitoring')
@ApiBearerAuth()
@Controller('monitoring')
export class MonitoringController {
  constructor(private monitoringService: MonitoringService) {}

  @Get('dashboard')
  getDashboard(@CurrentUser() user: any) {
    return this.monitoringService.getDashboardSummary(user.id);
  }

  @Get('biomarkers')
  getBiomarkers(@CurrentUser() user: any, @Query('panel') panel?: string) {
    return this.monitoringService.getBiomarkers(user.id, panel);
  }

  @Post('biomarkers')
  addBiomarker(@CurrentUser() user: any, @Body() body: any) {
    return this.monitoringService.addBiomarker(user.id, body);
  }

  @Get('symptoms')
  getSymptoms(@CurrentUser() user: any) {
    return this.monitoringService.getSymptoms(user.id);
  }

  @Post('symptoms')
  addSymptom(@CurrentUser() user: any, @Body() body: any) {
    return this.monitoringService.addSymptom(user.id, body);
  }

  @Get('timeline')
  getTimeline(@CurrentUser() user: any) {
    return this.monitoringService.getTimeline(user.id);
  }
}
