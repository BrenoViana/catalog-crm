import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AppSettingsService } from '../settings/app-settings.service';
import type { AuthUser } from './current-user.decorator';
import { FixedWindowLimiter, clientIp } from './fixed-window-limiter';

/**
 * Rate limit da liberacao de supervisor (`POST /access/authorize`).
 *
 * Sem isto a rota e um oraculo de senha: qualquer usuario autenticado chuta
 * credenciais de gerente sem limite, e um acerto vale um vale de `sales.cancel`
 * ou `sales.discountOverride` — dinheiro saindo do caixa com aparencia legitima.
 *
 * O teto e bem menor que o do login porque o uso legitimo e raro: um supervisor
 * digitando a senha no balcao erra uma ou duas vezes, nao vinte. As chaves
 * incluem o OPERADOR autenticado (nao so o IP), entao trocar de rede nao
 * escapa do limite enquanto o token for o mesmo.
 */
@Injectable()
export class GrantRateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter();

  constructor(private readonly settings: AppSettingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const max = await this.settings.getNumber('authorize.rateLimit.max');
    const windowMs = await this.settings.getNumber(
      'authorize.rateLimit.windowMs',
    );

    const req = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      user?: AuthUser;
      body?: { username?: unknown };
    }>();

    const ip = clientIp(req);
    const operatorId = req.user?.userId ?? 'anon';
    const alvo =
      typeof req.body?.username === 'string'
        ? req.body.username.toLowerCase().slice(0, 64)
        : '';

    const retry = this.limiter.hit(
      [`op:${operatorId}`, `ip:${ip}`, `alvo:${alvo}`],
      max,
      windowMs,
    );
    if (retry !== null) {
      throw new HttpException(
        `Muitas tentativas de liberacao. Tente novamente em ${retry}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
