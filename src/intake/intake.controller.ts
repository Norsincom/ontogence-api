import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CreateIntakeLogDto } from './dto/create-intake-log.dto';
import { UpdateIntakeLogDto } from './dto/update-intake-log.dto';
import { QueryIntakeLogsDto } from './dto/query-intake-logs.dto';
import { ClerkAuthGuard } from '../common/guards/clerk-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('intake')
@UseGuards(ClerkAuthGuard)
export class IntakeController {
  constructor(private readonly intakeService: IntakeService) {}

  // ─── Client endpoints (own logs) ─────────────────────────────────────────

  @Post()
  async create(@Req() req: any, @Body() dto: CreateIntakeLogDto) {
    return this.intakeService.createLog(
      req.user.id,
      req.user.id,
      dto,
      req.ip,
    );
  }

  @Get()
  async getAll(@Req() req: any, @Query() query: QueryIntakeLogsDto) {
    return this.intakeService.getLogs(req.user.id, query);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.intakeService.getLog(id, req.user.id);
  }

  @Patch(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateIntakeLogDto,
  ) {
    return this.intakeService.updateLog(id, req.user.id, req.user.id, dto, req.ip);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.intakeService.deleteLog(id, req.user.id, req.user.id, req.ip);
  }

  // ─── Admin endpoints (any user's logs) ───────────────────────────────────

  @Get('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async adminGetAll(
    @Param('userId') userId: string,
    @Query() query: QueryIntakeLogsDto,
  ) {
    return this.intakeService.adminGetLogs(userId, query);
  }

  @Post('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async adminCreate(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() dto: CreateIntakeLogDto,
  ) {
    return this.intakeService.adminCreateLog(userId, req.user.id, dto, req.ip);
  }

  @Patch('admin/:userId/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async adminUpdate(
    @Req() req: any,
    @Param('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateIntakeLogDto,
  ) {
    return this.intakeService.adminUpdateLog(id, userId, req.user.id, dto, req.ip);
  }

  @Delete('admin/:userId/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  async adminDelete(
    @Req() req: any,
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.intakeService.adminDeleteLog(id, userId, req.user.id, req.ip);
  }
}
