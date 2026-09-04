import type { Sale, StoreSettings } from './api-client';
import { brl, num, paymentLabel } from './format';

/** Resumo da venda em texto puro, para enviar por WhatsApp ou e-mail. */
export function receiptText(sale: Sale, store?: StoreSettings | null): string {
  const storeName = store?.tradeName || store?.legalName || 'Minha Loja';
  const when = new Date(sale.completedAt ?? sale.createdAt).toLocaleString('pt-BR');
  const lines: string[] = [storeName, `Venda #${sale.number} — ${when}`, ''];

  for (const item of sale.items ?? []) {
    lines.push(`${num(item.quantity, 0)} x ${item.description} — ${brl(item.total)}`);
  }
  if (sale.items?.length) lines.push('');

  if (sale.discount > 0) lines.push(`Desconto: -${brl(sale.discount)}`);
  lines.push(`TOTAL: ${brl(sale.total)}`);

  const payments = (sale.payments ?? []).map(
    (p) => `${paymentLabel[p.method] ?? p.method} ${brl(p.amount)}`,
  );
  if (payments.length) lines.push(`Pagamento: ${payments.join(' + ')}`);

  const fiscal = sale.fiscalDocument;
  if (fiscal?.status === 'AUTORIZADA' && fiscal.accessKey) {
    lines.push('', `NFC-e: ${fiscal.accessKey}`);
  }

  lines.push('', 'Obrigado pela preferência!');
  return lines.join('\n');
}

/**
 * wa.me exige o número em formato internacional só com dígitos. Sem telefone
 * (ou com número curto demais), abre o WhatsApp sem destinatário e o operador
 * escolhe o contato.
 */
export function whatsappUrl(text: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits.length > 11 ? digits : '';
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(text: string, subject: string, email?: string | null): string {
  return `mailto:${email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}
