import { Controller, Get, Put, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('profile')
  getProfile(@CurrentUser() user: any) {
    return this.usersService.getProfile(user.id);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('consent')
  getConsent(@CurrentUser() user: any) {
    return this.usersService.getConsentRecords(user.id);
  }

  @Post('consent')
  signConsent(@CurrentUser() user: any, @Body() body: { documentType: string; documentVersion: string }, @Req() req: any) {
    const ip = req.ip || req.headers['x-forwarded-for'];
    return this.usersService.signConsent(user.id, body.documentType, body.documentVersion, ip);
  }
}
