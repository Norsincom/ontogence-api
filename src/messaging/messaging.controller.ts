import { Controller, Get, Post, Body, Param, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { MessagingService } from './messaging.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('messaging')
@ApiBearerAuth()
@Controller('messaging')
export class MessagingController {
  constructor(private messagingService: MessagingService) {}

  @Get('conversations')
  getConversations(@CurrentUser() user: any) {
    return this.messagingService.getMyConversations(user.id, user.role);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: any,
    @Body() body: { staffId?: string; clientId?: string; subject?: string },
  ) {
    const isAdmin = ['admin', 'super_admin'].includes(user.role);

    let clientId: string;
    let staffId: string;

    if (isAdmin) {
      // Admin creates conversation: clientId must be provided, staffId defaults to admin
      clientId = body.clientId || user.id;
      staffId = body.staffId || user.id;
    } else {
      // Client creates conversation: clientId is ALWAYS the authenticated user
      // Clients CANNOT set clientId to someone else — prevents impersonation
      clientId = user.id;
      // staffId must be provided (the admin they want to talk to)
      // If not provided, it defaults to the first super_admin (handled in service)
      staffId = body.staffId || user.id;
    }

    return this.messagingService.createConversation(clientId, staffId, body.subject);
  }

  @Get('conversations/:id/messages')
  getMessages(@CurrentUser() user: any, @Param('id') id: string) {
    return this.messagingService.getMessages(id, user.id, user.role);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { body: string; attachmentKey?: string; attachmentUrl?: string; attachmentName?: string },
  ) {
    return this.messagingService.sendMessage(
      id,
      user.id,
      body.body,
      user.role,
      body.attachmentKey,
      body.attachmentUrl,
      body.attachmentName,
      user.name,
    );
  }

  @Get('unread')
  getUnread(@CurrentUser() user: any) {
    return this.messagingService.getUnreadCount(user.id);
  }

  /** Returns the super_admin user info so clients can initiate a conversation */
  @Get('admin-user')
  getAdminUser() {
    return this.messagingService.getAdminUser();
  }

  /**
   * Search clients by name, email, or ONTID.
   * Super admin only — used by the New Message modal.
   */
  @Get('search-clients')
  searchClients(@CurrentUser() user: any, @Query('q') q: string) {
    // Only super_admin can search all clients
    if (!['admin', 'super_admin'].includes(user.role)) {
      throw new ForbiddenException('Access denied');
    }
    return this.messagingService.searchClients(q || '');
  }
}
