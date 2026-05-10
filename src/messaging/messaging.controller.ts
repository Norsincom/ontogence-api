import { Controller, Get, Post, Body, Param } from '@nestjs/common';
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
    const clientId = body.clientId || user.id;
    const staffId = body.staffId || user.id;
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
    return this.messagingService.sendMessage(id, user.id, body.body, user.role, body.attachmentKey, body.attachmentUrl, body.attachmentName);
  }

  @Get('unread')
  getUnread(@CurrentUser() user: any) {
    return this.messagingService.getUnreadCount(user.id);
  }
}
