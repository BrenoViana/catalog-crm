/**
 * Serializacao CSV dos relatorios.
 *
 * Duas decisoes que parecem cosmeticas e nao sao:
 *
 * 1. Separador `;` e BOM UTF-8. O Excel em pt-BR abre CSV virgula como uma
 *    coluna so e come os acentos sem o BOM. O lojista abre o arquivo no Excel,
 *    nao num editor de texto.
 *
 * 2. Neutralizacao de formula. Uma celula que comeca com `=`, `+`, `-`, `@`,
 *    TAB ou CR e interpretada como formula pelo Excel/Sheets — e o conteudo vem
 *    de campo livre (nome de produto, nome de cliente, motivo de devolucao).
 *    Um produto chamado `=HYPERLINK(...)` viraria codigo executado na maquina
 *    de quem abre a planilha (CSV injection). Prefixamos com apostrofo.
 *
 *    Isso vale so para celula de origem LIVRE. Numero formatado por este modulo
 *    nao passa pela neutralizacao: `-` esta na lista de prefixos perigosos, e
 *    prefixar um negativo faria o Excel ler `'-123,45` como TEXTO — a coluna
 *    para de somar, e some do total justamente o prejuizo (devolucao, margem
 *    negativa). Coluna numerica se declara com `numeric: true`.
 */

const RISKY_PREFIX = /^[=+\-@\t\r]/;

function cell(value: unknown, numeric = false): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (!numeric && RISKY_PREFIX.test(text)) text = `'${text}`;
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
  /** Coluna gerada por `csvNumber`: nao leva neutralizacao de formula. */
  numeric?: boolean;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => cell(c.header)).join(';');
  const body = rows.map((r) =>
    columns.map((c) => cell(c.value(r), c.numeric)).join(';'),
  );
  return `\ufeff${[head, ...body].join('\r\n')}\r\n`;
}

/** Numero no formato que o Excel pt-BR entende como numero (virgula decimal). */
export const csvNumber = (value: number, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '';

/**
 * Nome de arquivo seguro para o cabecalho Content-Disposition: so o alfabeto
 * que nao permite quebrar o header nem escapar de diretorio.
 */
export const safeFilename = (name: string) =>
  name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
