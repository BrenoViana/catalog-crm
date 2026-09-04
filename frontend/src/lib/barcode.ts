/**
 * Código de balança (EAN-13 com prefixo 2).
 *
 * Layout suportado:  2 IIIIII PPPPP D
 *   2       prefixo de uso interno da loja
 *   IIIIII  código do item (6 dígitos) — casa com o SKU ou o barcode cadastrado
 *   PPPPP   peso em gramas (5 dígitos, até 99,999 kg)
 *   D       dígito verificador
 *
 * Só tratamos a variante com PESO embutido, nunca preço: o preço da venda
 * continua vindo do cadastro do produto (o servidor é a fonte da verdade e
 * nunca aceita preço do cliente).
 */
export interface ScaleCode {
  /** Código do item impresso na etiqueta (6 dígitos). */
  itemCode: string;
  /** Peso lido da etiqueta, em quilos. */
  kg: number;
}

export function parseScaleBarcode(raw: string): ScaleCode | null {
  const code = String(raw ?? '').replace(/\D/g, '');
  if (code.length !== 13 || !code.startsWith('2')) return null;

  const itemCode = code.slice(1, 7);
  const grams = Number(code.slice(7, 12));
  if (!Number.isFinite(grams) || grams <= 0) return null;

  return { itemCode, kg: Math.round(grams) / 1000 };
}
