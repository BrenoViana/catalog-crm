/** Início que o Excel/Sheets interpretaria como fórmula ao abrir a célula. */
const RISKY_PREFIX = /^[=+\-@\t\r]/;
/** Número puro (inclui negativo e decimal pt-BR): pode começar com sinal sem risco. */
const LOOKS_NUMERIC = /^[-+]?[\d.,]+$/;

/**
 * Monta um CSV com separador ";" (padrão pt-BR/Excel) e campos entre aspas.
 *
 * Campos de texto que começam com `= + - @ TAB CR` recebem um apóstrofo à
 * frente: sem isso, um cliente cadastrado como `=HYPERLINK(...)` viraria
 * fórmula viva na planilha de quem exporta (CSV injection). Valores numéricos
 * — mesmo negativos, como "Total gasto" — passam intactos, senão o Excel os lê
 * como texto e para de somar a coluna. Mesma regra do `reports/csv.ts` do
 * backend.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? '' : String(v);
    if (typeof v !== 'number' && RISKY_PREFIX.test(s) && !LOOKS_NUMERIC.test(s)) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

/** Dispara o download de um texto como arquivo no navegador. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
