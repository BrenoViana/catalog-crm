import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { SaleReceipt } from '../components/SaleReceipt';
import {
  fiscalApi,
  salesApi,
  storeSettingsApi,
  type FiscalStatus,
  type PaymentMethod,
  type Sale,
} from '../lib/api-client';
import { brl, dateTime, paymentLabel, round2, toNumber } from '../lib/format';

const REFUND_METHODS: PaymentMethod[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];

const fiscalLabel: Record<FiscalStatus, string> = {
  NAO_EMITIDA: 'Não emitida',
  PENDENTE: 'Pendente',
  PROCESSANDO: 'Processando',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Rejeitada',
  CANCELADA: 'Cancelada',
  CONTINGENCIA: 'Contingência',
};

const fiscalTag = (s: FiscalStatus) =>
  s === 'AUTORIZADA'
    ? 'tag-success'
    : s === 'REJEITADA' || s === 'CANCELADA'
      ? 'tag-warning'
      : '';

function ReturnModal({
  sale,
  onClose,
  onDone,
}: {
  sale: Sale;
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('DINHEIRO');

  // Quanto de cada item da venda já foi devolvido em devoluções anteriores.
  const returnedByItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of sale.returns ?? []) {
      for (const it of r.items) {
        map[it.saleItemId] = (map[it.saleItemId] ?? 0) + it.quantity;
      }
    }
    return map;
  }, [sale.returns]);

  const rows = (sale.items ?? []).map((it) => {
    const remaining = round2(it.quantity - (returnedByItem[it.id] ?? 0));
    const asked = Math.min(Math.max(0, toNumber(qty[it.id] ?? '')), remaining);
    const unitNet = it.quantity > 0 ? it.total / it.quantity : 0;
    return { it, remaining, asked, refund: round2(unitNet * asked) };
  });

  const refundTotal = round2(rows.reduce((acc, r) => acc + r.refund, 0));
  const canSubmit = refundTotal > 0 && reason.trim().length >= 3;

  const submit = useMutation({
    mutationFn: () =>
      salesApi.createReturn(sale.id, {
        items: rows
          .filter((r) => r.asked > 0)
          .map((r) => ({ saleItemId: r.it.id, quantity: r.asked })),
        reason: reason.trim(),
        refundMethod: method,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onDone();
    },
  });

  return (
    <Modal
      title={`Devolver itens — Venda #${sale.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'Registrando…' : `Devolver ${brl(refundTotal)}`}
          </button>
        </>
      }
    >
      <ul className="return-list">
        {rows.map(({ it, remaining, asked, refund }) => (
          <li key={it.id} className="return-row">
            <div>
              <strong>{it.description}</strong>
              <small>
                vendido {it.quantity} · disponível para devolução {remaining}
              </small>
            </div>
            <div className="qty-control">
              <button
                type="button"
                disabled={asked <= 0}
                onClick={() => setQty((q) => ({ ...q, [it.id]: String(Math.max(0, asked - 1)) }))}
              >
                −
              </button>
              <input
                inputMode="decimal"
                value={qty[it.id] ?? ''}
                placeholder="0"
                onChange={(e) => setQty((q) => ({ ...q, [it.id]: e.target.value }))}
              />
              <button
                type="button"
                disabled={asked >= remaining}
                onClick={() => setQty((q) => ({ ...q, [it.id]: String(Math.min(remaining, asked + 1)) }))}
              >
                +
              </button>
            </div>
            <strong className="return-row-refund">{brl(refund)}</strong>
          </li>
        ))}
      </ul>

      <label className="field">
        <span>Motivo da devolução</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: produto com defeito" />
      </label>
      <label className="field">
        <span>Forma de reembolso</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {REFUND_METHODS.map((m) => (
            <option key={m} value={m}>
              {paymentLabel[m]}
            </option>
          ))}
        </select>
      </label>
      {method === 'DINHEIRO' ? (
        <p className="muted">Sai do caixa aberto como sangria.</p>
      ) : null}
      {submit.error ? (
        <div className="error-message">
          {submit.error instanceof Error ? submit.error.message : 'Erro ao devolver'}
        </div>
      ) : null}
    </Modal>
  );
}

export function SalesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  const sales = useQuery({ queryKey: ['sales'], queryFn: () => salesApi.list() });
  const store = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });
  const detail = useQuery({
    queryKey: ['sales', selected],
    queryFn: () => salesApi.get(selected as string),
    enabled: !!selected,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => salesApi.cancel(id, 'Cancelada pelo operador'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelected(null);
    },
  });

  const reemit = useMutation({
    mutationFn: (docId: string) => fiscalApi.emit(docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales', selected] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
  });

  const statusTag = (s: Sale['status']) =>
    s === 'CONCLUIDA' ? 'tag-success' : s === 'CANCELADA' ? 'tag-warning' : '';

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Histórico</p>
          <h1>Vendas</h1>
        </div>
      </div>

      <div className="split-layout">
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.data?.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    className={selected === s.id ? 'row-active' : 'row-clickable'}
                  >
                    <td>{s.number}</td>
                    <td>
                      <small>{dateTime(s.completedAt ?? s.createdAt)}</small>
                    </td>
                    <td>{s.customer?.name ?? 'Não identificado'}</td>
                    <td style={{ textAlign: 'right' }}>{brl(s.total)}</td>
                    <td>
                      <span className={`tag ${statusTag(s.status)}`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
                {sales.data?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Nenhuma venda registrada ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>{selected ? `Venda #${detail.data?.number ?? ''}` : 'Detalhe'}</h2>
          </div>
          {!selected ? (
            <p className="muted">Selecione uma venda para ver os itens.</p>
          ) : detail.isLoading ? (
            <p className="muted">Carregando…</p>
          ) : detail.data ? (
            <>
              <ul className="list-rows">
                {detail.data.items?.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.description} <small>× {it.quantity}</small>
                    </span>
                    <strong>{brl(it.total)}</strong>
                  </li>
                ))}
              </ul>
              <div className="cart-summary">
                <span>Total</span>
                <strong>{brl(detail.data.total)}</strong>
              </div>
              <ul className="list-rows" style={{ marginTop: 12 }}>
                {detail.data.payments?.map((p) => (
                  <li key={p.id}>
                    <span>{paymentLabel[p.method] ?? p.method}</span>
                    <strong>{brl(p.amount)}</strong>
                  </li>
                ))}
              </ul>
              {detail.data.fiscalDocument ? (
                <div className="fiscal-box">
                  <div className="fiscal-box-head">
                    <span>NFC-e</span>
                    <span className={`tag ${fiscalTag(detail.data.fiscalDocument.status)}`}>
                      {fiscalLabel[detail.data.fiscalDocument.status]}
                    </span>
                  </div>
                  {detail.data.fiscalDocument.accessKey ? (
                    <p className="fiscal-key">{detail.data.fiscalDocument.accessKey}</p>
                  ) : null}
                  {detail.data.fiscalDocument.rejectionReason ? (
                    <p className="muted">{detail.data.fiscalDocument.rejectionReason}</p>
                  ) : null}
                  {(detail.data.fiscalDocument.status === 'PENDENTE' ||
                    detail.data.fiscalDocument.status === 'REJEITADA') ? (
                    <button
                      className="mini-button"
                      disabled={reemit.isPending}
                      onClick={() => reemit.mutate(detail.data!.fiscalDocument!.id)}
                    >
                      {reemit.isPending ? 'Reemitindo…' : 'Reemitir NFC-e'}
                    </button>
                  ) : null}
                  {reemit.error ? (
                    <p className="muted">
                      {reemit.error instanceof Error ? reemit.error.message : 'Erro ao reemitir'}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {detail.data.returns && detail.data.returns.length > 0 ? (
                <div className="returns-box">
                  <h3 className="turn-report-sub">Devoluções</h3>
                  <ul className="list-rows">
                    {detail.data.returns.map((r) => (
                      <li key={r.id}>
                        <span>
                          #{r.number} · {paymentLabel[r.refundMethod] ?? r.refundMethod}{' '}
                          <small>
                            {dateTime(r.createdAt)} —{' '}
                            {r.items.map((i) => `${i.quantity}× ${i.description}`).join(', ')}
                          </small>
                        </span>
                        <strong className="text-warning">− {brl(r.total)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="row-actions" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
                <button className="ghost-button" onClick={() => window.print()}>
                  Reimprimir recibo
                </button>
                {detail.data.status === 'CONCLUIDA' ? (
                  <>
                    <button className="ghost-button" onClick={() => setReturning(true)}>
                      Devolver itens
                    </button>
                    <button
                      className="danger-button"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(detail.data!.id)}
                    >
                      {cancel.isPending ? 'Cancelando…' : 'Cancelar venda (estorna estoque)'}
                    </button>
                  </>
                ) : null}
              </div>
              {cancel.error ? (
                <div className="error-message" style={{ marginTop: 12 }}>
                  {cancel.error instanceof Error ? cancel.error.message : 'Erro'}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      {returning && detail.data ? (
        <ReturnModal
          sale={detail.data}
          onClose={() => setReturning(false)}
          onDone={() => setReturning(false)}
        />
      ) : null}

      {detail.data ? (
        <SaleReceipt
          sale={detail.data}
          store={store.data}
          operatorName={detail.data.operator?.name}
          customerName={detail.data.customer?.name ?? undefined}
        />
      ) : null}
    </Layout>
  );
}
