import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AppSettingsService } from '../settings/app-settings.service';
import { FixedWindowLimiter, clientIp } from './fixed-window-limiter';

/**
 * Rate limit para o login (defesa contra brute force). A chave combina IP e
 * IP+username, entao um IP sozinho nao trava o login dos demais e tentativas
 * contra um mesmo usuario sao limitadas independentemente da origem.
 *
 * Os limites vem do banco (`login.rateLimit.max` e `login.rateLimit.windowMs`),
 * ajustaveis em Configuracoes.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter();

  constructor(private readonly settings: AppSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const max = await this.settings.getNumber('login.rateLimit.max');
    const windowMs = await this.settings.getNumber('login.rateLimit.windowMs');

    const req = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      body?: { username?: unknown };
    }>();

    const ip = clientIp(req);
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.toLowerCase().slice(0, 64)
        : '';

    const retry = this.limiter.hit(
      [`ip:${ip}`, `id:${ip}|${username}`],
      max,
      windowMs,
    );
    if (retry !== null) {
      throw new HttpException(
        `Muitas tentativas de login. Tente novamente em ${retry}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
