import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FixedWindowLimiter, clientIp } from '../common/fixed-window-limiter';

/**
 * Teto de requisicoes por IP na rota publica de imagem do produto.
 *
 * A rota nao tem autenticacao (`<img src>` nao manda header Authorization) e
 * cada acerto vira uma consulta que traz ate 512 KB do Postgres, segurando uma
 * das POUCAS conexoes do pool — as mesmas que o checkout usa. Sem teto, quem
 * conhecesse um unico token (basta ter aberto a tela de Produtos e olhado o
 * DevTools, ou ser um ex-funcionario) poderia esgotar o pool e parar o balcao
 * sem nenhuma credencial.
 *
 * O limite e alto de proposito: uma tela de catalogo em grade carrega dezenas
 * de miniaturas de uma vez, e o navegador nao pode esbarrar nele. O que ele
 * corta e o volume de flood, nao o uso normal.
 */
const MAX_PER_WINDOW = 600;
const WINDOW_MS = 60_000;

@Injectable()
export class ProductImageRateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();

    const retry = this.limiter.hit([`img:${clientIp(req)}`], MAX_PER_WINDOW, WINDOW_MS);
    if (retry !== null) {
      throw new HttpException(
        `Muitas requisições de imagem. Tente novamente em ${retry}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
