import { Controller, Get, Post, Patch, Body, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProtocolsService } from './protocols.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('protocols')
@ApiBearerAuth()
@Controller('protocols')
export class ProtocolsController {
  constructor(private protocolsService: ProtocolsService) {}

  @Get()
  getMyProtocols(@CurrentUser() user: any) {
    return this.protocolsService.getMyProtocols(user.id, user.role);
  }

  @Get(':id')
  getProtocol(@CurrentUser() user: any, @Param('id') id: string) {
    return this.protocolsService.getProtocol(id, user.id, user.role);
  }

  @Post()
  @Roles('admin', 'super_admin')
  createProtocol(
    @CurrentUser() user: any,
    @Body() body: { clientId: string; title: string; content: string },
  ) {
    return this.protocolsService.createProtocol(
      user.id,
      body.clientId,
      body.title,
      body.content,
      user.role,
      user.name,
    );
  }

  @Patch(':id/deliver')
  @Roles('admin', 'super_admin')
  deliverProtocol(@CurrentUser() user: any, @Param('id') id: string) {
    return this.protocolsService.deliverProtocol(id, user.id, user.role, user.name);
  }

  @Post(':id/versions')
  @Roles('admin', 'super_admin')
  addVersion(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { content: string; notes?: string },
  ) {
    return this.protocolsService.addVersion(id, user.id, body.content, body.notes, user.role, user.name);
  }

  /**
   * GET /protocols/:id/pdf
   * Download a protocol as a PDF with the client ONTID embedded in the header and footer.
   */
  @Get(':id/pdf')
  async downloadPdf(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.protocolsService.generateProtocolPdf(id, user.id, user.role);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ontogence-protocol-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }
}
