import './PdvPage.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { SaleReceipt } from '../components/SaleReceipt';
import { CustomerFormModal, blankCustomerForm } from '../components/CustomerFormModal';
import {
  cashApi,
  customersApi,
  productsApi,
  salesApi,
  storeSettingsApi,
  type Customer,
  type PaymentMethod,
  type Product,
  type Sale,
} from '../lib/api-client';
import { brl, paymentLabel, resolveDiscount, round2, toNumber } from '../lib/format';
import { parseScaleBarcode } from '../lib/barcode';
import { mailtoUrl, receiptText, whatsappUrl } from '../lib/receipt-share';
import { getTerminal, setTerminal } from '../lib/terminal';
import { useAuthStore } from '../store/authStore';

interface CartLine {
  product: Product;
  quantity: number;
  /** Desconto do item em R$ (texto do campo). */
  discount: string;
}

interface PayRow {
  method: PaymentMethod;
  /** Valor em R$ (texto). Em branco = "o que faltar para fechar a venda". */
  amount: string;
  installments: number;
}

const METHODS: PaymentMethod[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];
const MAX_INSTALLMENTS = 12;
const EPS = 0.005;

const newPayRow = (method: PaymentMethod): PayRow => ({ method, amount: '', installments: 1 });

/** Um leitor de código de barras "digita" rápido e finaliza com Enter. */
const SCAN_GAP_MS = 60;

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/**
 * Valores efetivos de cada pagamento: linhas com valor digitado valem o que
 * foi digitado; linhas em branco absorvem o que ainda falta (a primeira pega
 * tudo o que resta), permitindo dividir o pagamento sem digitar todos os valores.
 */
function settlePayments(rows: PayRow[], total: number): number[] {
  const explicitSum = rows.reduce(
    (acc, r) => acc + (r.amount.trim() === '' ? 0 : Math.max(0, toNumber(r.amount))),
    0,
  );
  let leftover = round2(Math.max(0, total - explicitSum));
  return rows.map((r) => {
    if (r.amount.trim() !== '') return round2(Math.max(0, toNumber(r.amount)));
    const take = leftover;
    leftover = 0;
    return take;
  });
}

export function PdvPage() {
  const queryClient = useQueryClient();
  const operatorName = useAuthStore((s) => s.user?.name);
  const operatorRole = useAuthStore((s) => s.user?.role);
  const [terminal, setTerminalName] = useState(getTerminal);
  const [term, setTerm] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleDiscount, setSaleDiscount] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [payments, setPayments] = useState<PayRow[]>([newPayRow('DINHEIRO')]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [justAdded, setJustAdded] = useState<{ id: string; name: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cash = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const store = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });
  const results = useQuery({
    queryKey: ['products', 'pdv', term],
    queryFn: () => productsApi.list({ search: term, onlyActive: true }),
    enabled: term.trim().length >= 2,
  });

  // ---------------------------------------------------------------- Totais
  const lineGross = useCallback((l: CartLine) => l.product.price * l.quantity, []);
  const lineDiscount = useCallback(
    (l: CartLine) => resolveDiscount(l.discount, lineGross(l)),
    [lineGross],
  );
  const lineTotal = useCallback(
    (l: CartLine) => round2(lineGross(l) - lineDiscount(l)),
    [lineGross, lineDiscount],
  );

  const grossSubtotal = useMemo(
    () => round2(cart.reduce((acc, l) => acc + lineGross(l), 0)),
    [cart, lineGross],
  );
  const itemDiscountTotal = useMemo(
    () => round2(cart.reduce((acc, l) => acc + lineDiscount(l), 0)),
    [cart, lineDiscount],
  );
  const netSubtotal = round2(grossSubtotal - itemDiscountTotal);
  const saleDisc = resolveDiscount(saleDiscount, netSubtotal);
  const total = round2(netSubtotal - saleDisc);

  // Politica de desconto: teto do operador (itens + venda sobre o bruto).
  const discountPct =
    grossSubtotal > 0 ? ((grossSubtotal - total) / grossSubtotal) * 100 : 0;
  const discountLimit = store.data?.maxDiscountPercentOperator ?? null;
  const overDiscountLimit =
    operatorRole === 'OPERADOR' &&
    discountLimit != null &&
    discountPct > discountLimit + 0.01;

  const effective = useMemo(() => settlePayments(payments, total), [payments, total]);
  const paid = round2(effective.reduce((acc, v) => acc + v, 0));
  const cashPaid = round2(
    effective.reduce((acc, v, i) => acc + (payments[i]?.method === 'DINHEIRO' ? v : 0), 0),
  );
  const nonCashPaid = round2(paid - cashPaid);
  const falta = round2(Math.max(0, total - paid));
  const troco = round2(Math.min(Math.max(0, paid - total), cashPaid));
  const nonCashOverpay = nonCashPaid > total + EPS;

  // ---------------------------------------------------------------- Carrinho
  const addToCart = useCallback((product: Product, quantity = 1) => {
    setScanMiss(null);
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === product.id);
      if (found) {
        return prev.map((l) =>
          l.product.id === product.id
            ? { ...l, quantity: Math.round((l.quantity + quantity) * 1000) / 1000 }
            : l,
        );
      }
      return [...prev, { product, quantity, discount: '' }];
    });
    setTerm('');
    searchRef.current?.focus();
  }, []);

  const setQty = (id: string, quantity: number) =>
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );

  /** Itens por peso andam de 100 g; por unidade, de 1 em 1. */
  const stepQty = (l: CartLine, dir: 1 | -1) => {
    const step = l.product.pricingMode === 'WEIGHT' ? 0.1 : 1;
    return Math.max(0, Math.round((l.quantity + dir * step) * 1000) / 1000);
  };

  const setLineDiscount = (id: string, discount: string) =>
    setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, discount } : l)));

  /** Resolve um código exato (barras/SKU); se não achar, tenta a busca textual. */
  const resolveCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;

      // Etiqueta de balança: o peso vem embutido no próprio código.
      const scale = parseScaleBarcode(code);
      if (scale) {
        try {
          const weighed = await productsApi.byCode(scale.itemCode);
          if (weighed.pricingMode === 'WEIGHT') {
            addToCart(weighed, scale.kg);
            return;
          }
        } catch {
          /* não é um item de balança conhecido: cai no fluxo normal */
        }
      }

      try {
        const product = await productsApi.byCode(code);
        addToCart(product);
      } catch {
        if (results.data && results.data.length > 0) {
          addToCart(results.data[0]);
        } else {
          setScanMiss(code);
        }
      }
    },
    [addToCart, results.data],
  );

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void resolveCode(term);
  };

  // ---------------------------------------------------------------- Pagamentos
  const setPay = (i: number, patch: Partial<PayRow>) =>
    setPayments((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addPay = () =>
    setPayments((prev) => [
      ...prev,
      newPayRow(prev.some((r) => r.method === 'DINHEIRO') ? 'PIX' : 'DINHEIRO'),
    ]);
  const removePay = (i: number) =>
    setPayments((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const resetSale = () => {
    setCart([]);
    setSaleDiscount('');
    setPayments([newPayRow('DINHEIRO')]);
    setCustomerId('');
    setScanMiss(null);
  };

  const sale = useMutation({
    mutationFn: () =>
      salesApi.create({
        items: cart.map((l) => ({
          productId: l.product.id,
          quantity: l.quantity,
          discount: lineDiscount(l) > 0 ? round2(lineDiscount(l)) : undefined,
        })),
        payments: payments
          .map((r, i) => ({
            method: r.method,
            amount: round2(effective[i] ?? 0),
            installments: r.method === 'CREDITO' ? r.installments : undefined,
          }))
          .filter((p) => p.amount > 0),
        discount: saleDisc > 0 ? round2(saleDisc) : undefined,
        customerId: customerId || undefined,
        terminal: terminal || undefined,
      }),
    onSuccess: (created) => {
      setFeedback(`Venda #${created.number} concluída — ${brl(created.total)}`);
      setLastSale(created);
      resetSale();
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      searchRef.current?.focus();
    },
  });

  const canFinish =
    cart.length > 0 &&
    total > EPS &&
    paid + EPS >= total &&
    !nonCashOverpay &&
    !overDiscountLimit &&
    !sale.isPending;

  const printReceipt = useCallback(() => {
    if (!lastSale) return;
    window.print();
  }, [lastSale]);

  /** Recibo digital: abre WhatsApp (wa.me) ou o cliente de e-mail com o resumo. */
  const shareReceipt = useCallback(
    (via: 'whatsapp' | 'email') => {
      if (!lastSale) return;
      const text = receiptText(lastSale, store.data);
      const url =
        via === 'whatsapp'
          ? whatsappUrl(text, lastSale.customer?.phone)
          : mailtoUrl(text, `Recibo da venda #${lastSale.number}`, lastSale.customer?.email);
      window.open(url, '_blank', 'noopener');
    },
    [lastSale, store.data],
  );

  // Atalhos de teclado do balcão.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Não interferir enquanto um modal (ex.: cadastro de cliente) está aberto.
      if (document.querySelector('.modal-backdrop')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (canFinish) sale.mutate();
      } else if (e.key === 'F9') {
        e.preventDefault();
        printReceipt();
      } else if (e.key === 'Escape') {
        if (cart.length > 0) resetSale();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFinish, cart.length, printReceipt, sale]);

  // Buffer de leitor de código de barras quando o foco não está num campo.
  useEffect(() => {
    let buffer = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const now = Date.now();
      if (now - last > SCAN_GAP_MS) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        if (buffer.length >= 3) void resolveCode(buffer);
        buffer = '';
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resolveCode]);

  // Cliente recém-cadastrado no balcão pode não voltar na lista (operador só vê
  // clientes por busca) — mantém a opção disponível até a próxima venda.
  const customerOptions = useMemo(() => {
    const base = (customers.data ?? []).map((c) => ({ id: c.id, name: c.name }));
    if (justAdded && !base.some((c) => c.id === justAdded.id)) base.unshift(justAdded);
    return base;
  }, [customers.data, justAdded]);

  const customerName = customerOptions.find((c) => c.id === customerId)?.name;

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Frente de caixa</p>
          <h1>Nova venda</h1>
        </div>
        <div className="header-tags">
          <label className="terminal-chip">
            <span>Terminal</span>
            <input
              value={terminal}
              placeholder="Caixa 01"
              maxLength={40}
              onChange={(e) => setTerminalName(e.target.value)}
              onBlur={(e) => setTerminalName(setTerminal(e.target.value))}
            />
          </label>
          <span className={`tag ${cash.data ? 'tag-success' : 'tag-warning'}`}>
            {cash.data ? 'Caixa aberto' : 'Caixa fechado'}
          </span>
        </div>
      </div>

      <p className="pdv-shortcuts">
        <kbd>F2</kbd> buscar · <kbd>F4</kbd> finalizar · <kbd>F9</kbd> imprimir recibo ·{' '}
        <kbd>Esc</kbd> limpar · <kbd>Enter</kbd> / leitor de código de barras adiciona o item
      </p>

      {!cash.data && !cash.isLoading ? (
        <div className="error-message">
          Nenhum caixa aberto — a venda será registrada, mas não entrará no controle de caixa.
          Abra o caixa em <strong>Caixa</strong>.
        </div>
      ) : null}
      {feedback ? (
        <div className="success-message">
          {feedback}
          {lastSale ? (
            <span className="receipt-actions">
              <button className="mini-button" onClick={printReceipt}>
                Imprimir (F9)
              </button>
              <button className="mini-button" onClick={() => shareReceipt('whatsapp')}>
                WhatsApp
              </button>
              <button className="mini-button" onClick={() => shareReceipt('email')}>
                E-mail
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {scanMiss ? (
        <div className="error-message">
          Código <strong>{scanMiss}</strong> não encontrado no catálogo.
        </div>
      ) : null}
      {sale.error ? (
        <div className="error-message">
          {sale.error instanceof Error ? sale.error.message : 'Erro ao finalizar a venda'}
        </div>
      ) : null}
      {overDiscountLimit ? (
        <div className="error-message">
          Desconto de {discountPct.toFixed(1)}% acima do limite de{' '}
          {Number(discountLimit).toFixed(0)}% para o operador. Reduza o desconto ou peça
          liberação a um gerente.
        </div>
      ) : null}

      <div className="pdv-layout">
        <div className="pdv-catalog">
          <section className="panel">
            <div className="panel-header">
              <h2>Produtos</h2>
            </div>
            <input
              ref={searchRef}
              autoFocus
              className="field-input"
              placeholder="Buscar por nome, SKU ou código de barras…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={onSearchKey}
            />
            <ul className="result-list">
              {results.data?.map((p) => (
                <li key={p.id}>
                  <button className="result-row" onClick={() => addToCart(p)}>
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.sku} · estoque {p.stock?.quantity ?? 0} {p.unit}
                      </small>
                    </span>
                    <span>{brl(p.price)}</span>
                  </button>
                </li>
              ))}
              {term.trim().length >= 2 && results.data?.length === 0 ? (
                <li className="muted" style={{ padding: '10px 4px' }}>
                  Nenhum produto encontrado.
                </li>
              ) : null}
            </ul>
          </section>

          <section className="panel pdv-checkout">
            <div className="cart-summary">
              <span>Total</span>
              <strong>{brl(total)}</strong>
            </div>

            <div className="cart-totals">
              <label className="field">
                <span>Desconto na venda</span>
                <input
                  inputMode="text"
                  value={saleDiscount}
                  placeholder="R$ ou % (ex.: 5 ou 5%)"
                  onChange={(e) => setSaleDiscount(e.target.value)}
                />
                {saleDisc > 0 ? <small className="muted">−{brl(saleDisc)}</small> : null}
                {discountLimit != null && operatorRole === 'OPERADOR' ? (
                  <small className="muted">Limite do operador: {Number(discountLimit).toFixed(0)}%</small>
                ) : null}
              </label>
            </div>

          <label className="field">
            <span>Cliente (opcional)</span>
            <div className="input-with-action">
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Consumidor não identificado</option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mini-button"
                onClick={() => setQuickAdd(true)}
              >
                + Cadastrar
              </button>
            </div>
          </label>

          <div className="pay-list">
            {payments.map((p, i) => (
              <div className="pay-row" key={i}>
                <select
                  value={p.method}
                  onChange={(e) => setPay(i, { method: e.target.value as PaymentMethod })}
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {paymentLabel[m]}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  value={p.amount}
                  placeholder={(effective[i] ?? 0).toFixed(2)}
                  onChange={(e) => setPay(i, { amount: e.target.value })}
                />
                {p.method === 'CREDITO' ? (
                  <select
                    value={p.installments}
                    onChange={(e) => setPay(i, { installments: Number(e.target.value) })}
                  >
                    {Array.from({ length: MAX_INSTALLMENTS }, (_, k) => k + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}x
                      </option>
                    ))}
                  </select>
                ) : null}
                {payments.length > 1 ? (
                  <button
                    type="button"
                    className="mini-button danger"
                    aria-label="Remover pagamento"
                    onClick={() => removePay(i)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" className="mini-button" onClick={addPay}>
            + Dividir pagamento
          </button>

          <div className="pay-status">
            {falta > EPS ? (
              <span className="text-warning">Falta {brl(falta)}</span>
            ) : nonCashOverpay ? (
              <span className="text-warning">
                Pagamento eletrônico acima do total — não há troco
              </span>
            ) : troco > EPS ? (
              <span>Troco {brl(troco)}</span>
            ) : (
              <span className="text-success">Pagamento completo</span>
            )}
          </div>

          <button
            className="primary-button large-button"
            disabled={!canFinish}
            onClick={() => sale.mutate()}
          >
            {sale.isPending ? 'Finalizando…' : `Finalizar venda — ${brl(total)}`}
          </button>
          </section>
        </div>

        <section className="panel pdv-cart">
          <div className="panel-header">
            <h2>Carrinho ({cart.length})</h2>
          </div>

          {cart.length === 0 ? (
            <p className="muted">Adicione produtos para iniciar a venda.</p>
          ) : (
            <ul className="cart">
              {cart.map((l) => (
                <li key={l.product.id} className="cart-line">
                  <div className="cart-line-row">
                    <div className="cart-line-main">
                      <strong>{l.product.name}</strong>
                      <small>{brl(l.product.price)} / {l.product.unit}</small>
                    </div>
                    <div className="qty-control">
                      <button onClick={() => setQty(l.product.id, stepQty(l, -1))}>−</button>
                      <input
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) =>
                          setQty(l.product.id, Math.max(0, toNumber(e.target.value)))
                        }
                      />
                      <button onClick={() => setQty(l.product.id, stepQty(l, 1))}>+</button>
                    </div>
                    <strong className="cart-line-total">{brl(lineTotal(l))}</strong>
                  </div>
                  <div className="cart-line-extra">
                    <label>
                      <span>Desconto</span>
                      <input
                        inputMode="text"
                        value={l.discount}
                        placeholder="R$ ou %"
                        onChange={(e) => setLineDiscount(l.product.id, e.target.value)}
                      />
                    </label>
                    {lineDiscount(l) > 0 ? (
                      <small className="muted">
                        −{brl(lineDiscount(l))} · bruto {brl(lineGross(l))}
                      </small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="cart-totals cart-subtotal">
            <div className="cart-totals-row">
              <span>Subtotal</span>
              <span>{brl(grossSubtotal)}</span>
            </div>
            {itemDiscountTotal > 0 ? (
              <div className="cart-totals-row">
                <span>Descontos nos itens</span>
                <span>−{brl(itemDiscountTotal)}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {quickAdd ? (
        <CustomerFormModal
          title="Cadastrar cliente"
          variant="quick"
          initial={blankCustomerForm}
          onClose={() => setQuickAdd(false)}
          onSubmit={(payload) => customersApi.create(payload)}
          onSaved={(created) => {
            const c = created as Customer;
            setJustAdded({ id: c.id, name: c.name });
            setCustomerId(c.id);
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            setQuickAdd(false);
          }}
        />
      ) : null}

      {lastSale ? (
        <SaleReceipt
          sale={lastSale}
          store={store.data}
          operatorName={operatorName}
          customerName={lastSale.customer?.name ?? customerName}
        />
      ) : null}
    </Layout>
  );
}
