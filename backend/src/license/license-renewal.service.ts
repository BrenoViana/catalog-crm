import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { verifyLicenseKey } from './license-key';

/**
 * Renovacao online da chave (a metade "hibrida" do modelo).
 *
 * A chave assinada vale sozinha, sem rede. Este servico so tenta trocar por
 * uma mais nova quando ha internet — e qualquer falha e silenciosa, porque a
 * loja nao pode parar por causa do servidor de licencas do fornecedor.
 *
 * Revogar um cliente = parar de renovar a chave dele. A chave atual continua
 * valendo ate vencer, o que e o comportamento correto: ninguem fica sem sistema
 * no meio do expediente por uma decisao comercial tomada naquela manha.
 */

const INTERVALO_MS = 12 * 60 * 60 * 1000; // 12h
const TIMEOUT_MS = 10_000;

@Injectable()
export class LicenseRenewalService implements OnModuleInit {
  private readonly log = new Logger(LicenseRenewalService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
  ) {}

  onModuleInit() {
    if (!this.endpoint) return;
    // `void promise` NAO captura rejeicao: uma falha do Prisma aqui virava
    // unhandled rejection, e o Node 20 derruba o processo por padrao — ou seja,
    // a rotina de licenca podia matar o PDV, exatamente o que este desenho
    // promete nunca fazer. O gatilho provavel e banal: banco ainda subindo 5s
    // depois do boot, ou pool saturado.
    const disparar = () => {
      this.tentar().catch((err) =>
        this.log.error(
          `Renovacao de licenca falhou: ${err instanceof Error ? err.message : err}`,
        ),
      );
    };
    // Primeira tentativa fora do caminho do boot: renovacao nao pode atrasar
    // a subida do backend.
    setTimeout(disparar, 5_000).unref?.();
    this.timer = setInterval(disparar, INTERVALO_MS);
    this.timer.unref?.();
  }

  /**
   * URL do servidor de licencas. Vem do AMBIENTE, nunca de dado de usuario ou
   * do banco — e o que impede esta rotina de virar SSRF: nenhum operador da
   * loja escolhe para onde o servidor disca.
   */
  private get endpoint(): string | null {
    const raw = (process.env.LICENSE_RENEW_URL ?? '').trim();
    if (!raw) return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      this.log.error('LICENSE_RENEW_URL invalida; renovacao desligada.');
      return null;
    }
    // Fora de desenvolvimento so https: a chave e o CNPJ do cliente viajam ali.
    if (url.protocol !== 'https:' && process.env.NODE_ENV !== 'development') {
      this.log.error('LICENSE_RENEW_URL precisa ser https; renovacao desligada.');
      return null;
    }
    return url.toString();
  }

  async tentar(): Promise<'renovada' | 'sem_mudanca' | 'indisponivel'> {
    const endpoint = this.endpoint;
    if (!endpoint) return 'indisponivel';

    const atual = await this.prisma.license.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!atual?.key) return 'indisponivel';

    const publicKey = (process.env.LICENSE_PUBLIC_KEY ?? '').trim();
    if (!publicKey) return 'indisponivel';

    let novaChave: string;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chave: atual.key }),
        signal: ctrl.signal,
        // Nao seguir redirect: o destino e fixo por configuracao, e um 302
        // para outro host transformaria isto num vazamento da chave.
        redirect: 'manual',
      });
      clearTimeout(t);
      if (!res.ok) return 'indisponivel';
      const body = (await res.json()) as { chave?: unknown };
      if (typeof body?.chave !== 'string' || !body.chave.trim()) {
        return 'indisponivel';
      }
      novaChave = body.chave.trim();
    } catch {
      // Rede fora, servidor fora, timeout: e o caso NORMAL numa loja.
      return 'indisponivel';
    }

    if (novaChave === atual.key) return 'sem_mudanca';

    // A chave que vem da rede passa pela MESMA verificacao da que e digitada.
    // Isso fecha a FORJA, mas nao o replay: o servidor de licencas ve as chaves
    // de todos os clientes e poderia devolver a de outro (upgrade indevido) ou
    // uma antiga do mesmo cliente (downgrade, derrubando quem esta em dia).
    // Por isso a nova chave tem de ser do MESMO cliente e MAIS NOVA.
    const check = verifyLicenseKey(novaChave, publicKey);
    if (!check.ok) {
      this.log.error(`Chave recebida na renovacao foi recusada: ${check.motivo}`);
      return 'indisponivel';
    }

    const atualCheck = verifyLicenseKey(atual.key, publicKey);
    if (atualCheck.ok) {
      const mesmoCliente =
        check.payload.cliente === atualCheck.payload.cliente &&
        (check.payload.cnpj ?? null) === (atualCheck.payload.cnpj ?? null);
      if (!mesmoCliente) {
        this.log.error(
          'Renovacao devolveu chave de OUTRO cliente; ignorada. ' +
            'Verifique o servidor de licencas.',
        );
        return 'indisponivel';
      }
      if (
        Date.parse(check.payload.emitidaEm) <=
        Date.parse(atualCheck.payload.emitidaEm)
      ) {
        // Nao e erro: e o servidor devolvendo o que ja temos, ou tentando
        // rebaixar. Em qualquer caso, ficamos com a atual.
        return 'sem_mudanca';
      }
    }

    // Transacao: sem ela, uma falha entre os dois passos deixava a instalacao
    // com ZERO licenca ativa — e a proxima renovacao precisa da chave atual
    // para pedir a nova, entao ela nunca mais se recuperaria sozinha.
    await this.prisma.$transaction([
      this.prisma.license.updateMany({
        where: { active: true },
        data: { active: false },
      }),
      this.prisma.license.upsert({
        where: { key: novaChave },
        update: { customer: check.payload.cliente, active: true },
        create: { key: novaChave, customer: check.payload.cliente, active: true },
      }),
    ]);
    this.license.invalidate();
    this.log.log(
      `Licenca renovada ate ${check.payload.expiraEm} (${check.payload.modulos.join(', ') || 'somente nucleo'}).`,
    );
    return 'renovada';
  }
}
