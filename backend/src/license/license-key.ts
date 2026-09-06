import { createPublicKey, verify } from 'node:crypto';
import { SELLABLE_MODULES, type ModuleKey } from './module-catalog';

/**
 * Formato e verificacao da chave de licenca.
 *
 *   CATALOG-1.<payload base64url>.<assinatura base64url>
 *
 * O payload e JSON assinado com Ed25519. A instalacao so tem a chave PUBLICA
 * (embutida por env no build); a privada fica com o fornecedor e nunca entra
 * no repositorio. Isso permite verificar sem rede — o requisito de balcao.
 *
 * Nao ha segredo dentro do payload: ele e legivel por qualquer um. A assinatura
 * garante que ninguem ALTERA a lista de modulos ou a validade, nao que ninguem
 * a leia. Chave nenhuma resiste a quem tem o binario e o banco; o que ela faz e
 * tornar a violacao deliberada e demonstravel.
 */

export const LICENSE_PREFIX = 'CATALOG-1';

export interface LicensePayload {
  /** Nome do cliente, para exibir na tela e no suporte. */
  cliente: string;
  /** CNPJ do emitente, quando a venda e vinculada a ele. */
  cnpj?: string;
  /** Modulos acessorios liberados. O nucleo nunca aparece aqui. */
  modulos: ModuleKey[];
  /** ISO-8601. Data em que a chave para de valer. */
  expiraEm: string;
  /** ISO-8601. */
  emitidaEm: string;
  /** Identificador da emissao — permite rastrear e substituir uma chave. */
  jti: string;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload; expirada: boolean }
  | { ok: false; motivo: string };

/**
 * `Buffer.from(x, 'base64')` ENGOLE caracteres invalidos em silencio:
 * `Buffer.from('QUJD!!REVG','base64')` devolve "ABCDEF". Isso tornava a chave
 * maleavel — inserir lixo ou `====` no fim produzia textos diferentes que
 * verificavam igual, gerando linhas duplicadas em `License` e inutilizando
 * qualquer lista de bloqueio por string. Aqui so passa base64url canonico.
 */
function decodeBase64Url(v: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) {
    throw new Error('Segmento base64url invalido.');
  }
  return Buffer.from(v, 'base64url');
}

/** Aceita PEM ou base64 cru (SPKI) para a chave publica. */
function loadPublicKey(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return createPublicKey(trimmed);
  }
  return createPublicKey({
    key: Buffer.from(trimmed, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/**
 * Verifica assinatura e formato. NAO decide o que fazer com chave expirada —
 * devolve `expirada` e deixa a politica para quem chamou, porque vencer a
 * licenca nao pode derrubar o PDV.
 */
export function verifyLicenseKey(
  key: string,
  publicKeyRaw: string,
  agora: Date = new Date(),
): VerifyResult {
  const partes = key.trim().split('.');
  if (partes.length !== 3 || partes[0] !== LICENSE_PREFIX) {
    return { ok: false, motivo: 'Formato de chave invalido.' };
  }

  const [prefixo, payloadB64, sigB64] = partes;

  let publicKey;
  try {
    publicKey = loadPublicKey(publicKeyRaw);
  } catch {
    return { ok: false, motivo: 'Chave publica de licenca mal configurada.' };
  }

  // Assinamos "prefixo.payload" e nao so o payload: sem o prefixo, a mesma
  // assinatura valeria para uma versao futura do formato.
  const assinado = Buffer.from(`${prefixo}.${payloadB64}`, 'utf8');

  let assinaturaOk = false;
  try {
    assinaturaOk = verify(null, assinado, publicKey, decodeBase64Url(sigB64));
  } catch {
    assinaturaOk = false;
  }
  if (!assinaturaOk) {
    return { ok: false, motivo: 'Assinatura da licenca nao confere.' };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, motivo: 'Conteudo da licenca ilegivel.' };
  }
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, motivo: 'Conteudo da licenca ilegivel.' };
  }

  if (typeof payload?.cliente !== 'string' || !payload.cliente.trim()) {
    return { ok: false, motivo: 'Licenca sem cliente.' };
  }
  if (!isIsoDate(payload.expiraEm) || !isIsoDate(payload.emitidaEm)) {
    return { ok: false, motivo: 'Licenca com datas invalidas.' };
  }
  if (!Array.isArray(payload.modulos)) {
    return { ok: false, motivo: 'Licenca sem lista de modulos.' };
  }

  // Modulo desconhecido e descartado em silencio: uma chave emitida por uma
  // versao mais nova nao pode quebrar uma instalacao mais velha.
  payload.modulos = payload.modulos.filter((m): m is ModuleKey =>
    (SELLABLE_MODULES as string[]).includes(m),
  );

  return {
    ok: true,
    payload,
    expirada: Date.parse(payload.expiraEm) < agora.getTime(),
  };
}

/** Dias que faltam para vencer (negativo quando ja venceu). */
export function diasParaVencer(expiraEm: string, agora: Date = new Date()): number {
  const ms = Date.parse(expiraEm) - agora.getTime();
  return Math.floor(ms / 86_400_000);
}
