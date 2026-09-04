import { Injectable, Logger } from '@nestjs/common';
import type {
  FiscalCancelContext,
  FiscalCancelResult,
  FiscalEmitContext,
  FiscalEmitResult,
  FiscalProvider,
} from './fiscal-provider';

/** Codigo IBGE da UF a partir da sigla — usado no inicio da chave de acesso. */
const UF_CODE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41',
  SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
const pad = (v: string | number, len: number) => String(v).padStart(len, '0').slice(-len);

/** Digito verificador modulo 11 (pesos 2..9), como na chave da NFC-e. */
function mod11(base: string): string {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = 11 - rest;
  return dv >= 10 ? '0' : String(dv);
}

/**
 * Provedor fiscal SIMULADO. Não fala com a SEFAZ: aplica as validações de
 * emitente que barrariam a nota de verdade e, passando, devolve uma chave de
 * acesso de 44 dígitos bem-formada, protocolo e string de QR Code. Serve para
 * exercitar todo o ciclo (autorização, rejeição, cancelamento) sem credenciais.
 */
@Injectable()
export class FakeFiscalProvider implements FiscalProvider {
  readonly name = 'fake';
  private readonly log = new Logger(FakeFiscalProvider.name);

  async emit(ctx: FiscalEmitContext): Promise<FiscalEmitResult> {
    const { store, sale, document } = ctx;

    const cnpj = onlyDigits(store.cnpj);
    if (cnpj.length !== 14) {
      return {
        status: 'REJEITADA',
        rejectionReason:
          'Emitente sem CNPJ válido — preencha em Configurações da loja.',
      };
    }
    if (!store.legalName?.trim()) {
      return { status: 'REJEITADA', rejectionReason: 'Emitente sem razão social.' };
    }
    if (!UF_CODE[(store.addressState ?? '').toUpperCase()]) {
      return {
        status: 'REJEITADA',
        rejectionReason: 'UF do emitente inválida — verifique o endereço da loja.',
      };
    }
    if (Number(sale.total) <= 0) {
      return { status: 'REJEITADA', rejectionReason: 'Total da nota deve ser maior que zero.' };
    }

    // Latência simbólica: um provedor real é limitado por rede/SEFAZ.
    await new Promise((r) => setTimeout(r, 40));

    const uf = UF_CODE[(store.addressState as string).toUpperCase()];
    const now = new Date();
    const aamm = `${pad(now.getFullYear() % 100, 2)}${pad(now.getMonth() + 1, 2)}`;
    const tpEmis = '1';
    const cNF = pad(Math.floor(Math.random() * 1e8), 8);
    const base43 =
      uf +
      aamm +
      cnpj +
      pad(document.model, 2) +
      pad(document.series, 3) +
      pad(document.number, 9) +
      tpEmis +
      cNF;
    const accessKey = base43 + mod11(base43);
    const protocol = `1${now.getFullYear()}${pad(Math.floor(Math.random() * 1e10), 10)}`;
    const env = store.nfceEnvironment === 'producao' ? '1' : '2';
    const qrCode =
      `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=` +
      `${accessKey}|2|${env}|${protocol}`;

    this.log.log(`NFC-e simulada AUTORIZADA — venda #${sale.number} chave ${accessKey}`);
    return {
      status: 'AUTORIZADA',
      accessKey,
      protocol,
      qrCode,
      xmlUrl: `about:blank#xml-${accessKey}`,
      danfeUrl: `about:blank#danfe-${accessKey}`,
    };
  }

  async cancel(ctx: FiscalCancelContext): Promise<FiscalCancelResult> {
    await new Promise((r) => setTimeout(r, 30));
    this.log.log(
      `NFC-e simulada CANCELADA — chave ${ctx.document.accessKey ?? '(sem chave)'}: ${ctx.reason}`,
    );
    return {
      status: 'CANCELADA',
      protocol: `1${new Date().getFullYear()}${pad(Math.floor(Math.random() * 1e10), 10)}`,
    };
  }
}
