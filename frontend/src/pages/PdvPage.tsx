import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import {
  cashApi,
  customersApi,
  productsApi,
  salesApi,
  type PaymentMethod,
  type Product,
} from '../lib/api-client';
import { brl, paymentLabel } from '../lib/format';

interface CartLine {
  product: Product;
  quantity: number;
}

const METHODS: PaymentMethod[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO'];

export function PdvPage() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('DINHEIRO');
  const [tendered, setTendered] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const cash = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
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

  const addToCart = (product: Product) => {
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
  };

  const setQty = (id: string, quantity: number) =>
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && results.data && results.data.length > 0) {
      addToCart(results.data[0]);
    }
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

      {!cash.data && !cash.isLoading ? (
        <div className="error-message">
          Nenhum caixa aberto — a venda será registrada, mas não entrará no controle de caixa.
          Abra o caixa em <strong>Caixa</strong>.
        </div>
      ) : null}
      {feedback ? <div className="success-message">{feedback}</div> : null}
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
    </Layout>
  );
}
