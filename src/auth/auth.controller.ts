import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.authService.getMe(user.id);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  completeOnboarding(@CurrentUser() user: any) {
    return this.authService.completeOnboarding(user.id);
  }
}
