import { Controller, Get, Patch, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAllUsers(+page, +limit, search);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Patch('users/:id/role')
  updateRole(
    @CurrentUser() admin: any,
    @Param('id') id: string,
    @Body() body: { role: string },
  ) {
    return this.adminService.updateUserRole(id, body.role as any, admin.id);
  }

  @Post('assign-consultant')
  assignConsultant(
    @CurrentUser() admin: any,
    @Body() body: { clientId: string; consultantId: string; notes?: string },
  ) {
    return this.adminService.assignConsultant(body.clientId, body.consultantId, admin.id, body.notes);
  }

  @Get('consultants')
  getConsultants() {
    return this.adminService.getConsultants();
  }

  @Get('audit-logs')
  getAuditLogs(
    @Query('page') page = 1,
    @Query('limit') limit = 100,
    @Query('userId') userId?: string,
  ) {
    return this.adminService.getAuditLogs(+page, +limit, userId);
  }

  @Get('users/:id/notes')
  getClientNotes(@Param('id') id: string) {
    return this.adminService.getClientNotes(id);
  }

  @Post('users/:id/notes')
  addClientNote(
    @CurrentUser() admin: any,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.adminService.addClientNote(id, admin.id, body.note);
  }
}
