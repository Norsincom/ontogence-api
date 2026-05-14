import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { VaultService } from './vault.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('vault')
@ApiBearerAuth()
@Controller('vault')
export class VaultController {
  constructor(private vaultService: VaultService) {}

  @Get()
  getFiles(@CurrentUser() user: any, @Query('category') category?: string) {
    return this.vaultService.getFiles(user.id, category);
  }

  @Post('upload-url')
  getUploadUrl(
    @CurrentUser() user: any,
    @Body() body: { fileName: string; mimeType: string; category: string },
  ) {
    return this.vaultService.getUploadUrl(user.id, body.fileName, body.mimeType, body.category);
  }

  @Post('confirm')
  confirmUpload(
    @CurrentUser() user: any,
    @Body() body: {
      storageKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      category: string;
      notes?: string;
    },
  ) {
    return this.vaultService.confirmUpload(
      user.id,
      body.storageKey,
      body.originalName,
      body.mimeType,
      body.sizeBytes,
      body.category,
      body.notes,
    );
  }

  @Get(':id/download')
  getDownloadUrl(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vaultService.getDownloadUrl(user.id, id, user.id, user.role);
  }

  /**
   * Archive endpoint — admin/super_admin only.
   * Clients do NOT have a delete endpoint. Any attempt to call
   * DELETE /vault/:id will return 404 (route does not exist).
   */
  @Delete(':id/archive')
  archiveFile(@CurrentUser() user: any, @Param('id') id: string) {
    return this.vaultService.archiveFile(user.id, user.role, id);
  }
}
