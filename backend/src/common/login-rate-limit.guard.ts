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

/**
 * Rate limit por IP para o login (defesa contra brute force).
 * Janela fixa em memoria — suficiente para o backend de uma loja unica.
 * Ajustavel por LOGIN_RATELIMIT_MAX e LOGIN_RATELIMIT_WINDOW_MS.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly max = Number(process.env.LOGIN_RATELIMIT_MAX ?? 10);
  private readonly windowMs = Number(
    process.env.LOGIN_RATELIMIT_WINDOW_MS ?? 60_000,
  );
  private readonly hits = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let bucket = this.hits.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, bucket);
    }
    bucket.count += 1;

    if (this.hits.size > 5000) {
      for (const [k, b] of this.hits) if (now >= b.resetAt) this.hits.delete(k);
    }

    if (bucket.count > this.max) {
      const retry = Math.ceil((bucket.resetAt - now) / 1000);
      throw new HttpException(
        `Muitas tentativas de login. Tente novamente em ${retry}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
