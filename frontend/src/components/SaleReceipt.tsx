import type { Sale, StoreSettings } from '../lib/api-client';
import { brl, paymentLabel } from '../lib/format';

interface Props {
  sale: Sale;
  store?: StoreSettings | null;
  operatorName?: string;
  customerName?: string;
}

/** Agrupa a chave de acesso de 44 dígitos em blocos de 4, como no DANFE. */
const groupKey = (key: string) => key.replace(/(.{4})/g, '$1 ').trim();

/**
 * Recibo de balcao em formato bobina (80mm). Fica fora da tela no fluxo normal
 * e so aparece na impressao (ver regras @media print em styles.css). Quando a
 * NFC-e da venda esta autorizada, o recibo sai com a chave de acesso; caso
 * contrario, sai marcado como sem valor fiscal.
 */
export function SaleReceipt({ sale, store, operatorName, customerName }: Props) {
  const items = sale.items ?? [];
  const payments = sale.payments ?? [];
  const paid = payments.reduce((acc, p) => acc + p.amount, 0);
  const troco = Math.max(0, paid - sale.total);
  const fiscal = sale.fiscalDocument;
  const fiscalAuthorized = fiscal?.status === 'AUTORIZADA' && !!fiscal.accessKey;

  const name = store?.tradeName || store?.legalName || 'Minha Loja';
  const addressLine = store
    ? [
        [store.addressStreet, store.addressNumber].filter(Boolean).join(', '),
        store.addressDistrict,
        [store.addressCity, store.addressState].filter(Boolean).join('/'),
      ]
        .filter(Boolean)
        .join(' — ')
    : '';

  return (
    <div id="receipt-print" className="receipt" aria-hidden="true">
      <div className="receipt-center receipt-strong">{name}</div>
      {store?.cnpj ? (
        <div className="receipt-center">CNPJ {store.cnpj}</div>
      ) : null}
      {addressLine ? <div className="receipt-center">{addressLine}</div> : null}
      {store?.phone ? (
        <div className="receipt-center">Tel {store.phone}</div>
      ) : null}

      <div className="receipt-rule" />
      <div className="receipt-center receipt-strong">
        {fiscalAuthorized ? `NFC-e #${sale.number}` : `RECIBO DE VENDA #${sale.number}`}
      </div>
      <div className="receipt-center receipt-muted">
        {fiscalAuthorized
          ? 'Documento Auxiliar da NFC-e'
          : 'Documento sem valor fiscal'}
      </div>

      <div className="receipt-rule" />
      <div className="receipt-row">
        <span>Data</span>
        <span>{new Date(sale.completedAt ?? sale.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      {operatorName ? (
        <div className="receipt-row">
          <span>Operador</span>
          <span>{operatorName}</span>
        </div>
      ) : null}
      {customerName ? (
        <div className="receipt-row">
          <span>Cliente</span>
          <span>{customerName}</span>
        </div>
      ) : null}

      <div className="receipt-rule" />
      <table className="receipt-items">
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td className="receipt-items-desc">
                {it.description}
                <br />
                <span className="receipt-muted">
                  {it.quantity} x {brl(it.unitPrice)}
                  {it.discount > 0 ? ` (- ${brl(it.discount)})` : ''}
                </span>
              </td>
              <td className="receipt-items-total">{brl(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-rule" />
      <div className="receipt-row">
        <span>Subtotal</span>
        <span>{brl(sale.subtotal)}</span>
      </div>
      {sale.discount > 0 ? (
        <div className="receipt-row">
          <span>Desconto</span>
          <span>- {brl(sale.discount)}</span>
        </div>
      ) : null}
      <div className="receipt-row receipt-strong receipt-total">
        <span>TOTAL</span>
        <span>{brl(sale.total)}</span>
      </div>

      <div className="receipt-rule" />
      {payments.map((p) => (
        <div className="receipt-row" key={p.id}>
          <span>{paymentLabel[p.method] ?? p.method}</span>
          <span>{brl(p.amount)}</span>
        </div>
      ))}
      {troco > 0 ? (
        <div className="receipt-row">
          <span>Troco</span>
          <span>{brl(troco)}</span>
        </div>
      ) : null}

      {fiscalAuthorized ? (
        <>
          <div className="receipt-rule" />
          <div className="receipt-center receipt-muted">
            Consulte pela chave de acesso em
          </div>
          <div className="receipt-center receipt-muted">
            www.nfce.fazenda.gov.br
          </div>
          <div className="receipt-center receipt-key">
            {groupKey(fiscal!.accessKey as string)}
          </div>
          {fiscal?.protocol ? (
            <div className="receipt-center receipt-muted">
              Protocolo {fiscal.protocol}
            </div>
          ) : null}
          {fiscal?.environment !== 'producao' ? (
            <div className="receipt-center receipt-muted">
              AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL
            </div>
          ) : null}
        </>
      ) : null}

      <div className="receipt-rule" />
      <div className="receipt-center receipt-muted">
        Obrigado pela preferência!
      </div>
    </div>
  );
}
