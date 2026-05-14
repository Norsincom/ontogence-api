import {
  Controller, Get, Patch, Post, Delete, Body, Param, Query,
} from '@nestjs/common';
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
  getStats() { return this.adminService.getStats(); }

  @Get('users')
  getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
  ) { return this.adminService.getAllUsers(+page, +limit, search); }

  @Get('users/:id')
  getUser(@Param('id') id: string) { return this.adminService.getUser(id); }

  // Deep client profile
  @Get('clients/:id/profile')
  getClientProfile(@Param('id') id: string) { return this.adminService.getClientProfile(id); }

  @Patch('clients/:id/profile')
  updateClientProfile(@CurrentUser() admin: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateClientProfile(id, admin.id, admin.role, body);
  }

  /**
   * ROLE CHANGE — SUPER_ADMIN ONLY
   *
   * Governance rules enforced here AND in the service layer:
   * - Only super_admin may call this endpoint (@Roles('super_admin'))
   * - The service additionally prevents: assigning super_admin, modifying admin@ontogence.com
   * - Full audit trail logged on every successful change
   */
  @Patch('users/:id/role')
  @Roles('super_admin')
  updateRole(
    @CurrentUser() admin: any,
    @Param('id') id: string,
    @Body() body: { role: string },
  ) {
    return this.adminService.updateUserRole(id, body.role as any, admin.id, admin.role);
  }

  // File management
  @Post('clients/:id/upload-url')
  getAdminUploadUrl(@CurrentUser() admin: any, @Param('id') clientId: string, @Body() body: { fileName: string; mimeType: string; category: string }) {
    return this.adminService.getAdminUploadUrl(admin.id, clientId, body.fileName, body.mimeType, body.category);
  }

  @Post('clients/:id/confirm-upload')
  adminConfirmUpload(@CurrentUser() admin: any, @Param('id') clientId: string, @Body() body: any) {
    return this.adminService.adminConfirmUpload(admin.id, admin.role, admin.name, clientId, body.storageKey, body.originalName, body.mimeType, body.sizeBytes, body.category, body.notes);
  }

  @Get('files/:fileId/download')
  adminGetDownloadUrl(@Param('fileId') fileId: string) { return this.adminService.adminGetDownloadUrl(fileId); }

  @Delete('files/:fileId')
  adminArchiveFile(@CurrentUser() admin: any, @Param('fileId') fileId: string) { return this.adminService.adminArchiveFile(fileId, admin.id); }

  // Protocol management
  @Post('clients/:id/protocols')
  adminCreateProtocol(@CurrentUser() admin: any, @Param('id') clientId: string, @Body() body: { title: string; content: string; category?: string }) {
    return this.adminService.adminCreateProtocol(admin.id, admin.role, admin.name, clientId, body.title, body.content, body.category);
  }

  @Patch('protocols/:protocolId')
  adminUpdateProtocol(@CurrentUser() admin: any, @Param('protocolId') protocolId: string, @Body() body: any) {
    return this.adminService.adminUpdateProtocol(admin.id, admin.role, admin.name, protocolId, body);
  }

  @Post('protocols/:protocolId/deliver')
  adminDeliverProtocol(@CurrentUser() admin: any, @Param('protocolId') protocolId: string) {
    return this.adminService.adminDeliverProtocol(admin.id, admin.role, admin.name, protocolId);
  }

  // Biomarker management
  @Post('clients/:id/biomarkers')
  adminAddBiomarker(@CurrentUser() admin: any, @Param('id') clientId: string, @Body() body: any) {
    return this.adminService.adminAddBiomarker(admin.id, admin.role, admin.name, clientId, body);
  }

  @Delete('biomarkers/:logId')
  adminDeleteBiomarker(@CurrentUser() admin: any, @Param('logId') logId: string) { return this.adminService.adminDeleteBiomarker(admin.id, logId); }

  // Assignments
  @Post('assign-consultant')
  assignConsultant(@CurrentUser() admin: any, @Body() body: { clientId: string; consultantId: string; notes?: string }) {
    return this.adminService.assignConsultant(body.clientId, body.consultantId, admin.id, body.notes);
  }

  @Delete('assignments/:assignmentId')
  removeAssignment(@CurrentUser() admin: any, @Param('assignmentId') assignmentId: string) { return this.adminService.removeAssignment(assignmentId, admin.id); }

  @Get('consultants')
  getConsultants() { return this.adminService.getConsultants(); }

  // Audit logs
  @Get('audit-logs')
  getAuditLogs(@Query('page') page = 1, @Query('limit') limit = 100, @Query('userId') userId?: string) {
    return this.adminService.getAuditLogs(+page, +limit, userId);
  }

  // Admin notes
  @Get('users/:id/notes')
  getClientNotes(@Param('id') id: string) { return this.adminService.getClientNotes(id); }

  @Post('users/:id/notes')
  addClientNote(@CurrentUser() admin: any, @Param('id') id: string, @Body() body: { note: string }) {
    return this.adminService.addClientNote(id, admin.id, body.note);
  }

  @Delete('notes/:noteId')
  deleteClientNote(@CurrentUser() admin: any, @Param('noteId') noteId: string) { return this.adminService.deleteClientNote(noteId, admin.id); }

  // Impersonation (super_admin only)
  @Post('clients/:id/impersonate')
  @Roles('super_admin')
  generateImpersonationToken(@CurrentUser() admin: any, @Param('id') clientId: string) {
    return this.adminService.generateImpersonationToken(admin.id, clientId);
  }
}
