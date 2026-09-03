import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Rate limit para o login (defesa contra brute force). Janela fixa em memoria,
 * suficiente para o backend de uma loja unica. A chave combina IP + username,
 * entao um IP sozinho nao trava o login dos demais e tentativas contra um mesmo
 * usuario sao limitadas independentemente da origem.
 *
 * Requer `app.set('trust proxy', ...)` para que req.ip reflita o cliente real
 * atras de um reverse proxy. Ajustavel por LOGIN_RATELIMIT_MAX e
 * LOGIN_RATELIMIT_WINDOW_MS.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly max = envInt('LOGIN_RATELIMIT_MAX', 10);
  private readonly windowMs = envInt('LOGIN_RATELIMIT_WINDOW_MS', 60_000);
  private readonly hits = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      body?: { username?: unknown };
    }>();

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.toLowerCase().slice(0, 64)
        : '';
    const now = Date.now();

    if (this.hits.size > 5000) {
      for (const [k, b] of this.hits) if (now >= b.resetAt) this.hits.delete(k);
    }

    // Conta na chave por IP e na chave por IP+usuario; estoura se qualquer uma passar.
    const keys = [`ip:${ip}`, `id:${ip}|${username}`];
    let blocked: Bucket | undefined;
    for (const key of keys) {
      let bucket = this.hits.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + this.windowMs };
        this.hits.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > this.max && (!blocked || bucket.resetAt < blocked.resetAt)) {
        blocked = bucket;
      }
    }

    if (blocked) {
      const retry = Math.ceil((blocked.resetAt - now) / 1000);
      throw new HttpException(
        `Muitas tentativas de login. Tente novamente em ${retry}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
