import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { LoginRateLimitGuard } from '../common/login-rate-limit.guard';
import { Public } from '../common/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LoginRateLimitGuard)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }
}
