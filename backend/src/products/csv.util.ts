/**
 * Parser de CSV minimo e sem dependencia, suficiente para importacao de
 * catalogo exportado de Excel / Google Sheets:
 * - detecta o separador (",", ";" ou TAB) pela linha de cabecalho;
 * - campos entre aspas podem conter o separador e quebras de linha;
 * - aspas duplas dentro de campo com aspas viram '""';
 * - aceita fim de linha CRLF ou LF e ignora BOM inicial.
 */
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, '');
  if (text.trim() === '') return [];

  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const delimiter = pickDelimiter(firstLine);

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // fim de linha CRLF: o \n cuida do resto
    } else {
      field += ch;
    }
  }
  // ultima linha sem quebra final
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function pickDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ';': (headerLine.match(/;/g) ?? []).length,
    ',': (headerLine.match(/,/g) ?? []).length,
    '\t': (headerLine.match(/\t/g) ?? []).length,
  };
  return (
    (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : ','
  );
}

/** Remove acentos, espacos das pontas e caixa, para casar cabecalhos. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Converte "R$ 1.234,56", "1234,56", "1234.56" ou "12" em numero.
 * Retorna null se nao for um numero valido.
 */
export function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/r\$/i, '').replace(/\s/g, '').trim();
  if (cleaned === '') return null;

  let normalized = cleaned;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    // o ultimo separador e o decimal; o outro e milhar
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
