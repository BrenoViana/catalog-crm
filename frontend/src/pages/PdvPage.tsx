import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { SaleReceipt } from '../components/SaleReceipt';
import {
  cashApi,
  customersApi,
  productsApi,
  salesApi,
  storeSettingsApi,
  type PaymentMethod,
  type Product,
  type Sale,
} from '../lib/api-client';
import { brl, paymentLabel } from '../lib/format';
import { useAuthStore } from '../store/authStore';

interface CartLine {
  product: Product;
  quantity: number;
}

const METHODS: PaymentMethod[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];

/** Um leitor de código de barras "digita" rápido e finaliza com Enter. */
const SCAN_GAP_MS = 60;

function isTypingTarget(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

export function PdvPage() {
  const queryClient = useQueryClient();
  const operatorName = useAuthStore((s) => s.user?.name);
  const [term, setTerm] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('DINHEIRO');
  const [tendered, setTendered] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cash = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const store = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });
  const results = useQuery({
    queryKey: ['products', 'pdv', term],
    queryFn: () => productsApi.list({ search: term, onlyActive: true }),
    enabled: term.trim().length >= 2,
  });

  const total = useMemo(
    () => cart.reduce((acc, l) => acc + l.product.price * l.quantity, 0),
    [cart],
  );
  const change = Math.max(0, (Number(tendered) || 0) - total);

  const addToCart = useCallback((product: Product) => {
    setScanMiss(null);
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === product.id);
      if (found) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
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

  /** Resolve um código exato (barras/SKU); se não achar, tenta a busca textual. */
  const resolveCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
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

  const sale = useMutation({
    mutationFn: () =>
      salesApi.create({
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        payments: [{ method, amount: method === 'DINHEIRO' ? total : Number(tendered) || total }],
        customerId: customerId || undefined,
      }),
    onSuccess: (created) => {
      setFeedback(`Venda #${created.number} concluída — ${brl(created.total)}`);
      setLastSale(created);
      setCart([]);
      setTendered('');
      setCustomerId('');
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cash'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      searchRef.current?.focus();
    },
  });

  const canFinish =
    cart.length > 0 &&
    (method !== 'DINHEIRO' || (Number(tendered) || 0) >= total) &&
    !sale.isPending;

  const printReceipt = useCallback(() => {
    if (!lastSale) return;
    window.print();
  }, [lastSale]);

  // Atalhos de teclado do balcão.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        if (cart.length > 0) {
          setCart([]);
          setTendered('');
          setScanMiss(null);
        }
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

  const customerName = customers.data?.find((c) => c.id === customerId)?.name;

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Frente de caixa</p>
          <h1>PDV / Nova venda</h1>
        </div>
        <span className={`tag ${cash.data ? 'tag-success' : 'tag-warning'}`}>
          {cash.data ? 'Caixa aberto' : 'Caixa fechado'}
        </span>
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
            <button
              className="mini-button"
              style={{ marginLeft: 12 }}
              onClick={printReceipt}
            >
              Imprimir recibo (F9)
            </button>
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

      <div className="pdv-layout">
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

        <section className="panel">
          <div className="panel-header">
            <h2>Carrinho ({cart.length})</h2>
          </div>

          {cart.length === 0 ? (
            <p className="muted">Adicione produtos para iniciar a venda.</p>
          ) : (
            <ul className="cart">
              {cart.map((l) => (
                <li key={l.product.id} className="cart-line">
                  <div className="cart-line-main">
                    <strong>{l.product.name}</strong>
                    <small>{brl(l.product.price)} / {l.product.unit}</small>
                  </div>
                  <div className="qty-control">
                    <button onClick={() => setQty(l.product.id, l.quantity - 1)}>−</button>
                    <input
                      value={l.quantity}
                      onChange={(e) =>
                        setQty(l.product.id, Math.max(0, Number(e.target.value) || 0))
                      }
                    />
                    <button onClick={() => setQty(l.product.id, l.quantity + 1)}>+</button>
                  </div>
                  <strong className="cart-line-total">{brl(l.product.price * l.quantity)}</strong>
                </li>
              ))}
            </ul>
          )}

          <div className="cart-summary">
            <span>Total</span>
            <strong>{brl(total)}</strong>
          </div>

          <label className="field">
            <span>Cliente (opcional)</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Consumidor não identificado</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="pay-methods">
            {METHODS.map((m) => (
              <button
                key={m}
                className={`pill-button ${method === m ? 'active' : ''}`}
                onClick={() => setMethod(m)}
              >
                {paymentLabel[m]}
              </button>
            ))}
          </div>

          {method === 'DINHEIRO' ? (
            <label className="field">
              <span>Valor recebido</span>
              <input
                inputMode="decimal"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder={total.toFixed(2)}
              />
              {change > 0 ? <small>Troco: {brl(change)}</small> : null}
            </label>
          ) : null}

          <button
            className="primary-button large-button"
            disabled={!canFinish}
            onClick={() => sale.mutate()}
          >
            {sale.isPending ? 'Finalizando…' : `Finalizar venda — ${brl(total)}`}
          </button>
        </section>
      </div>

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
