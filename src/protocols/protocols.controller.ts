import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
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
    return this.protocolsService.getMyProtocols(user.id);
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
    return this.protocolsService.createProtocol(user.id, body.clientId, body.title, body.content);
  }

  @Patch(':id/deliver')
  @Roles('admin', 'super_admin')
  deliverProtocol(@CurrentUser() user: any, @Param('id') id: string) {
    return this.protocolsService.deliverProtocol(id, user.id);
  }

  @Post(':id/versions')
  @Roles('admin', 'super_admin')
  addVersion(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { content: string; notes?: string },
  ) {
    return this.protocolsService.addVersion(id, user.id, body.content, body.notes);
  }
}
