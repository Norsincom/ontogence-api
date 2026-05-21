import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { PrescriptionsService } from './prescriptions.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { UpdatePrescriptionDto } from './dto/update-prescription.dto';
import { ClerkAuthGuard } from '../common/guards/clerk-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('prescriptions')
@UseGuards(ClerkAuthGuard)
export class PrescriptionsController {
  constructor(private readonly svc: PrescriptionsService) {}

  // ─── Client endpoints (own prescriptions) ────────────────────────────────

  @Post()
  create(@Req() req: any, @Body() dto: CreatePrescriptionDto) {
    return this.svc.create(req.user.id, req.user.id, dto);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.svc.findAll(req.user.id, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      search,
    });
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.svc.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdatePrescriptionDto) {
    return this.svc.update(id, req.user.id, req.user.id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.svc.remove(id, req.user.id);
  }

  @Post(':id/refresh-info')
  refreshInfo(@Req() req: any, @Param('id') id: string) {
    return this.svc.refreshMedInfo(id, req.user.id);
  }

  // ─── Admin endpoints (any user's prescriptions) ───────────────────────────

  @Get('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  adminFindAll(
    @Param('userId') userId: string,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.svc.adminFindAll(userId, {
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      search,
    });
  }

  @Post('admin/:userId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  adminCreate(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.svc.adminCreate(userId, req.user.id, dto);
  }

  @Patch('admin/:userId/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  adminUpdate(
    @Req() req: any,
    @Param('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionDto,
  ) {
    return this.svc.adminUpdate(id, userId, req.user.id, dto);
  }

  @Delete('admin/:userId/:id')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  adminRemove(
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.svc.adminRemove(id, userId);
  }

  @Post('admin/:userId/:id/refresh-info')
  @UseGuards(RolesGuard)
  @Roles('admin', 'super_admin')
  adminRefreshInfo(
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.svc.refreshMedInfo(id, userId);
  }
}
