import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Log estruturado de requisicao + alimentacao das metricas.
 *
 * Uma linha JSON por requisicao, em stdout: e o formato que qualquer coletor
 * (journald, Loki, um `jq` no terminal da loja) le sem parser proprio, e que
 * sobrevive a rotacao de arquivo. O `Logger` do Nest continua para mensagem de
 * aplicacao; aqui e o registro de acesso.
 *
 * O que NAO entra na linha, de proposito:
 *
 * - **Corpo da requisicao e da resposta.** O corpo do PDV leva CPF do cliente,
 *   e o de autenticacao leva senha. Log e o lugar onde dado pessoal vaza sem
 *   ninguem perceber, porque ninguem revisa log com o cuidado com que revisa
 *   uma tela (LGPD, art. 46).
 * - **Query string crua.** `?cpf=...` e `?q=<nome do cliente>` chegariam
 *   inteiros; so o conjunto de CHAVES e registrado, que e o que serve para
 *   depurar "a tela mandou o filtro errado".
 * - **Token e cookie.** O `Authorization` nunca e tocado; o que identifica quem
 *   fez e o `userId` que o guard ja resolveu.
 *
 * O `reqId` volta no header `x-request-id` para o suporte casar o print do
 * lojista com a linha do log. Se o cliente mandar o header, ele e adotado —
 * mas saneado: valor de terceiro entra em arquivo de log, e uma quebra de linha
 * ali forjaria uma entrada inteira (log injection).
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  /**
   * `HTTP_LOG=off` cala o registro de acesso sem desligar as metricas — e o que
   * o e2e usa para a saida do teste continuar legivel. Ligado por padrao: um
   * log que so existe quando alguem lembra de ligar nao serve de trilha.
   */
  private readonly enabled = (process.env.HTTP_LOG ?? 'on').toLowerCase() !== 'off';

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: { userId?: string } }>();
    const res = http.getResponse<Response>();

    const reqId = sanitizeId(req.headers['x-request-id']) ?? randomUUID();
    res.setHeader('x-request-id', reqId);
    (req as Request & { reqId?: string }).reqId = reqId;

    const started = process.hrtime.bigint();
    const finish = (erro?: unknown) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Caminho da ROTA, nao a URL: `/sales/:id` em vez de uma serie por venda.
      const rota = routeOf(req);
      const status = erro ? statusOf(erro) : res.statusCode;
      this.metrics.observeRequest(req.method, rota, status, ms);
      if (!this.enabled) return;

      process.stdout.write(
        `${JSON.stringify({
          ts: new Date().toISOString(),
          nivel: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          tipo: 'http',
          reqId,
          metodo: req.method,
          rota,
          status,
          ms: Math.round(ms * 10) / 10,
          userId: req.user?.userId ?? null,
          ip: req.ip ?? null,
          // Chaves do filtro, nunca os valores.
          query: Object.keys(req.query ?? {}).sort(),
          erro: erro ? messageOf(erro) : undefined,
        })}\n`,
      );
    };

    return next.handle().pipe(
      tap({
        next: () => finish(),
        error: (err) => finish(err),
      }),
    );
  }
}

/** Aceita o correlation id do cliente so em formato inofensivo e curto. */
function sanitizeId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  return /^[A-Za-z0-9._-]{8,64}$/.test(raw) ? raw : null;
}

/**
 * Caminho registrado da rota. O Express so preenche `req.route` depois que o
 * handler casa — numa 404 nao ha rota nenhuma, e a URL crua nao pode virar
 * rotulo de metrica (um scanner batendo em caminhos aleatorios criaria uma
 * serie por tentativa).
 */
function routeOf(req: Request): string {
  const path = (req as Request & { route?: { path?: string } }).route?.path;
  if (!path) return 'desconhecida';
  const base = (req.baseUrl ?? '').replace(/^\/api/, '');
  return `${base}${path}`.replace(/\/$/, '') || '/';
}

function statusOf(err: unknown): number {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? status : 500;
}

/** Mensagem sem corpo nem stack: o stack vai para o Logger, nao para o acesso. */
function messageOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/[\r\n]+/g, ' ').slice(0, 300);
}
