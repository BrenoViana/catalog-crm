import './PromotionsModal.css';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from './Modal';
import { IconPlus, IconSearch } from './ui-icons';
import {
  categoriesApi,
  productsApi,
  promotionsApi,
  type Promotion,
  type PromotionKind,
  type PromotionScope,
} from '../lib/api-client';
import { brl, dateOnly } from '../lib/format';

/**
 * Gestão das campanhas de desconto automático.
 *
 * A tela não calcula nada: quem decide o desconto é o servidor, no fechamento
 * da venda. Aqui só se descreve a regra. O resumo em linguagem natural existe
 * porque "PERCENT / ALL / 50" não diz a ninguém o que a loja vai praticar —
 * e uma campanha mal entendida é dinheiro saindo do caixa.
 */

const KIND_LABEL: Record<PromotionKind, string> = {
  PERCENT: 'Percentual',
  AMOUNT: 'Valor por unidade',
  FIXED_PRICE: 'Preço fixo',
  BUY_X_PAY_Y: 'Leve X, pague Y',
};

const SCOPE_LABEL: Record<PromotionScope, string> = {
  PRODUCT: 'Um produto',
  CATEGORY: 'Uma categoria',
  ALL: 'Todo o catálogo',
};

const EMPTY: PromotionForm = {
  name: '',
  description: '',
  kind: 'PERCENT',
  scope: 'PRODUCT',
  productId: '',
  categoryId: '',
  value: '',
  buyQty: '',
  payQty: '',
  minQuantity: '',
  startsAt: '',
  endsAt: '',
  priority: '0',
  active: true,
};

interface PromotionForm {
  name: string;
  description: string;
  kind: PromotionKind;
  scope: PromotionScope;
  productId: string;
  categoryId: string;
  value: string;
  buyQty: string;
  payQty: string;
  minQuantity: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  active: boolean;
}

/** `2026-09-05T13:00:00.000Z` -> `2026-09-05T13:00`, que é o que o input aceita. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Converte o que o gestor digitou, aceitando vírgula decimal.
 *
 * Não uso `toNumber` de lib/format aqui de propósito: ele devolve `0` para
 * entrada inválida, o que MASCARA o erro — e mascarar erro numa tela que define
 * preço foi exatamente a origem do SEC-034. Aqui `NaN` sobrevive para ser visto.
 */
function parse(v: string): number {
  return Number(v.trim().replace(',', '.'));
}

/** Campo vazio vira `null` = LIMPAR o campo no servidor. */
function limpavel(v: string): number | null {
  return v.trim() === '' ? null : parse(v);
}

/** Campo que não pode ser limpo: vazio some do corpo e o servidor mantém. */
function opcional(v: string): number | undefined {
  return v.trim() === '' ? undefined : parse(v);
}

/** Número digitado que não vira número finito. */
function invalido(v: string): boolean {
  return v.trim() !== '' && !Number.isFinite(parse(v));
}

function fromForm(f: PromotionForm) {
  return {
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    kind: f.kind,
    scope: f.scope,
    productId: f.scope === 'PRODUCT' ? f.productId || undefined : undefined,
    categoryId: f.scope === 'CATEGORY' ? f.categoryId || undefined : undefined,
    value: f.kind === 'BUY_X_PAY_Y' ? undefined : opcional(f.value),
    buyQty: f.kind === 'BUY_X_PAY_Y' ? opcional(f.buyQty) : undefined,
    payQty: f.kind === 'BUY_X_PAY_Y' ? opcional(f.payQty) : undefined,
    // `null` explícito: sem isso, esvaziar o campo não removia nada.
    minQuantity: limpavel(f.minQuantity),
    startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
    endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
    priority: opcional(f.priority) ?? 0,
    active: f.active,
  };
}

function toForm(p: Promotion): PromotionForm {
  return {
    name: p.name,
    description: p.description ?? '',
    kind: p.kind,
    scope: p.scope,
    productId: p.productId ?? '',
    categoryId: p.categoryId ?? '',
    value: p.value == null ? '' : String(Number(p.value)),
    buyQty: p.buyQty == null ? '' : String(p.buyQty),
    payQty: p.payQty == null ? '' : String(p.payQty),
    minQuantity: p.minQuantity == null ? '' : String(Number(p.minQuantity)),
    startsAt: toLocalInput(p.startsAt),
    endsAt: toLocalInput(p.endsAt),
    priority: String(p.priority ?? 0),
    active: p.active,
  };
}

/** Uma frase que diz o que a campanha faz de verdade. */
function resumo(f: PromotionForm, alvoNome: string): string {
  const alvo =
    f.scope === 'ALL'
      ? 'qualquer produto'
      : alvoNome
        ? alvoNome
        : f.scope === 'PRODUCT'
          ? 'o produto escolhido'
          : 'a categoria escolhida';
  const min =
    f.minQuantity && Number(f.minQuantity) > 0
      ? ` a partir de ${f.minQuantity} unidade(s)`
      : '';

  switch (f.kind) {
    case 'PERCENT':
      if (invalido(f.value)) return 'Percentual inválido.';
      return f.value
        ? `Desconto de ${parse(f.value)}% em ${alvo}${min}.`
        : 'Informe o percentual.';
    case 'AMOUNT':
      if (invalido(f.value)) return 'Valor inválido.';
      return f.value
        ? `Desconto de ${brl(parse(f.value))} por unidade de ${alvo}${min}.`
        : 'Informe o valor por unidade.';
    case 'FIXED_PRICE':
      if (invalido(f.value)) return 'Preço inválido.';
      return f.value
        ? `${alvo} passa a custar ${brl(parse(f.value))} por unidade${min}. Não encarece se o preço já for menor.`
        : 'Informe o preço promocional.';
    case 'BUY_X_PAY_Y': {
      if (!f.buyQty || !f.payQty) return 'Informe as quantidades.';
      if (invalido(f.buyQty) || invalido(f.payQty)) return 'Quantidades inválidas.';
      const buy = parse(f.buyQty);
      const pay = parse(f.payQty);
      if (pay >= buy) return 'Pague precisa ser menor que leve.';
      return `A cada ${buy} unidades de ${alvo}, o cliente paga ${pay} — ${buy - pay} sai(em) de graça. Só vale para item vendido por unidade.`;
    }
  }
}

/** Rótulo curto da janela de vigência para o card. */
function janelaLabel(p: Promotion): string | null {
  if (p.startsAt && p.endsAt) return `${dateOnly(p.startsAt)} – ${dateOnly(p.endsAt)}`;
  if (p.startsAt) return `a partir de ${dateOnly(p.startsAt)}`;
  if (p.endsAt) return `até ${dateOnly(p.endsAt)}`;
  return null;
}

/**
 * Formulário moderno de campanha, em modal.
 *
 * `promotion` nulo cria; preenchido edita. O modal não sabe da lista: ao salvar,
 * chama `onSaved` e quem hospeda decide o que invalidar.
 */
function PromotionFormModal({
  promotion,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PromotionForm>(
    promotion ? toForm(promotion) : EMPTY,
  );
  const [erro, setErro] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', 'promo'],
    queryFn: () => productsApi.list({ onlyActive: true }),
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  });

  const set = <K extends keyof PromotionForm>(k: K, v: PromotionForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const alvoNome = useMemo(() => {
    if (form.scope === 'PRODUCT') {
      return products.data?.find((p) => p.id === form.productId)?.name ?? '';
    }
    if (form.scope === 'CATEGORY') {
      return categories.data?.find((c) => c.id === form.categoryId)?.name ?? '';
    }
    return '';
  }, [form.scope, form.productId, form.categoryId, products.data, categories.data]);

  const salvar = useMutation({
    mutationFn: () =>
      promotion
        ? promotionsApi.update(promotion.id, fromForm(form))
        : promotionsApi.create(fromForm(form)),
    onSuccess: () => {
      setErro(null);
      onSaved();
    },
    onError: (e: unknown) =>
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  });

  const alvoObrigatorio =
    (form.scope === 'PRODUCT' && !form.productId) ||
    (form.scope === 'CATEGORY' && !form.categoryId);
  // Número digitado que não vira número trava o botão. Antes, "10,5" virava
  // NaN, o corpo saía com `null`, o servidor mantinha o valor antigo e a tela
  // dizia que tinha salvo (SEC-034).
  const numeroInvalido =
    invalido(form.value) ||
    invalido(form.buyQty) ||
    invalido(form.payQty) ||
    invalido(form.minQuantity) ||
    invalido(form.priority);
  const podeSalvar =
    form.name.trim().length > 0 && !alvoObrigatorio && !numeroInvalido;

  return (
    <Modal
      title={promotion ? `Editar campanha — ${promotion.name}` : 'Nova campanha'}
      onClose={onClose}
      width={680}
      footer={
        <>
          <label className="toggle spacer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Campanha ativa
          </label>
          <button className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={!podeSalvar || salvar.isPending}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending
              ? 'Salvando…'
              : promotion
                ? 'Salvar alterações'
                : 'Criar campanha'}
          </button>
        </>
      }
    >
      <div className="promo-form">
        <label className="field">
          <span>Nome da campanha</span>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ex.: Semana do cliente"
          />
        </label>

        <div className="form-grid">
          <label className="field">
            <span>Tipo de desconto</span>
            <select
              value={form.kind}
              onChange={(e) => set('kind', e.target.value as PromotionKind)}
            >
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Aplica-se a</span>
            <select
              value={form.scope}
              onChange={(e) => set('scope', e.target.value as PromotionScope)}
            >
              {Object.entries(SCOPE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form.scope === 'PRODUCT' ? (
          <label className="field">
            <span>Produto</span>
            <select
              value={form.productId}
              onChange={(e) => set('productId', e.target.value)}
            >
              <option value="">Selecione…</option>
              {(products.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {form.scope === 'CATEGORY' ? (
          <label className="field">
            <span>Categoria</span>
            <select
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">Selecione…</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {form.kind === 'BUY_X_PAY_Y' ? (
          <div className="form-grid">
            <label className="field">
              <span>Leve</span>
              <input
                inputMode="numeric"
                value={form.buyQty}
                onChange={(e) => set('buyQty', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Pague</span>
              <input
                inputMode="numeric"
                value={form.payQty}
                onChange={(e) => set('payQty', e.target.value)}
              />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>
              {form.kind === 'PERCENT'
                ? 'Percentual (%)'
                : form.kind === 'FIXED_PRICE'
                  ? 'Preço promocional (R$ por unidade)'
                  : 'Desconto (R$ por unidade)'}
            </span>
            <input
              inputMode="decimal"
              value={form.value}
              onChange={(e) => set('value', e.target.value)}
            />
          </label>
        )}

        <div className="form-grid">
          <label className="field">
            <span>Quantidade mínima</span>
            <input
              inputMode="decimal"
              value={form.minQuantity}
              placeholder="opcional"
              onChange={(e) => set('minQuantity', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Prioridade</span>
            <input
              inputMode="numeric"
              value={form.priority}
              onChange={(e) => set('priority', e.target.value)}
            />
          </label>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Começa em</span>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Termina em</span>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
            />
          </label>
        </div>

        <p className="promo-resumo">{resumo(form, alvoNome)}</p>
        <p className="promo-nota">
          Promoções não se acumulam: quando duas alcançam o mesmo item, vence a de
          maior prioridade. O desconto é sempre recalculado pelo servidor no
          fechamento da venda.
        </p>

        {erro ? <p className="promo-erro">{erro}</p> : null}
      </div>
    </Modal>
  );
}

/**
 * Corpo da gestão de campanhas, sem casca.
 *
 * Existe separado do modal porque a tela precisa ser alcançável por quem tem
 * `promotions.manage` e NÃO tem `settings.manage` — o GERENTE. Antes, o único
 * caminho passava por Configurações, e a saída prática era conceder o pacote
 * inteiro de configuração (CSC, teto de desconto, rate limit) só para deixar
 * alguém criar promoção (SEC-035).
 */
export function PromotionsManager() {
  const qc = useQueryClient();
  // `undefined` = modal fechado; `null` = criar; objeto = editar.
  const [editing, setEditing] = useState<Promotion | null | undefined>(undefined);
  const [confirmRemove, setConfirmRemove] = useState<Promotion | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const promotions = useQuery({
    queryKey: ['promotions'],
    queryFn: () => promotionsApi.list(),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['promotions'] });
  };

  const remover = useMutation({
    mutationFn: (id: string) => promotionsApi.remove(id),
    onSuccess: () => {
      setConfirmRemove(null);
      invalidar();
    },
    onError: (e: unknown) =>
      setErro(e instanceof Error ? e.message : 'Não foi possível remover.'),
  });

  const alternar = useMutation({
    mutationFn: (p: Promotion) => promotionsApi.update(p.id, { active: !p.active }),
    onSuccess: invalidar,
    onError: (e: unknown) =>
      setErro(
        e instanceof Error
          ? `Não foi possível mudar o estado da campanha: ${e.message}`
          : 'Não foi possível mudar o estado da campanha.',
      ),
  });

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const all = promotions.data ?? [];
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  }, [promotions.data, busca]);

  return (
    <div className="promo-manager">
      <div className="toolbar">
        <div className="toolbar-field has-icon">
          <span className="toolbar-icon">
            <IconSearch />
          </span>
          <input
            className="field-input"
            placeholder="Buscar campanha pelo nome…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <button
          className="primary-button with-icon"
          onClick={() => {
            setErro(null);
            setEditing(null);
          }}
        >
          <IconPlus />
          Nova campanha
        </button>
      </div>

      {promotions.isError ? (
        <p className="promo-erro">
          Não foi possível carregar as campanhas. A lista abaixo não reflete a
          loja — não crie campanha nova sem recarregar.
        </p>
      ) : null}
      {erro ? <p className="promo-erro">{erro}</p> : null}

      {promotions.isLoading ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="empty-state">
          <strong>
            {busca.trim()
              ? 'Nenhuma campanha corresponde à busca.'
              : 'Nenhuma campanha cadastrada.'}
          </strong>
          {busca.trim() ? null : (
            <span>Crie a primeira em “Nova campanha”.</span>
          )}
        </div>
      ) : (
        <div className="promo-cards">
          {lista.map((p) => {
            const alvoNome = p.product?.name ?? p.category?.name ?? '';
            const janela = janelaLabel(p);
            return (
              <article
                key={p.id}
                className={`promo-card ${p.active ? '' : 'is-off'}`}
              >
                <div className="promo-card-head">
                  <h3>{p.name}</h3>
                  <button
                    className={p.active ? 'promo-pill on' : 'promo-pill off'}
                    title={p.active ? 'Desativar campanha' : 'Ativar campanha'}
                    disabled={alternar.isPending}
                    onClick={() => alternar.mutate(p)}
                  >
                    {p.active ? 'ativa' : 'inativa'}
                  </button>
                </div>

                <p className="promo-card-summary">{resumo(toForm(p), alvoNome)}</p>

                <div className="promo-card-tags">
                  <span className="promo-tag">{KIND_LABEL[p.kind]}</span>
                  <span className="promo-tag">
                    {p.scope === 'ALL' ? SCOPE_LABEL.ALL : alvoNome || SCOPE_LABEL[p.scope]}
                  </span>
                  {p.priority ? (
                    <span className="promo-tag">prioridade {p.priority}</span>
                  ) : null}
                  {janela ? <span className="promo-tag">{janela}</span> : null}
                </div>

                <div className="promo-card-actions">
                  <button
                    className="mini-button"
                    onClick={() => {
                      setErro(null);
                      setEditing(p);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="mini-button danger"
                    onClick={() => {
                      setErro(null);
                      setConfirmRemove(p);
                    }}
                  >
                    Remover
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing !== undefined ? (
        <PromotionFormModal
          promotion={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            invalidar();
          }}
        />
      ) : null}

      {confirmRemove ? (
        <Modal
          title="Remover campanha"
          onClose={() => setConfirmRemove(null)}
          width={460}
          footer={
            <>
              <button
                className="ghost-button"
                onClick={() => setConfirmRemove(null)}
              >
                Cancelar
              </button>
              <button
                className="danger-button"
                disabled={remover.isPending}
                onClick={() => remover.mutate(confirmRemove.id)}
              >
                {remover.isPending ? 'Removendo…' : 'Remover'}
              </button>
            </>
          }
        >
          <p>
            Remover a campanha <strong>{confirmRemove.name}</strong>?
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            O desconto deixa de valer na próxima venda. Vendas já fechadas não
            mudam.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** A mesma gestão, em modal, para quem chega por Configurações. */
export function PromotionsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Promoções" onClose={onClose} width={1040}>
      <PromotionsManager />
    </Modal>
  );
}
