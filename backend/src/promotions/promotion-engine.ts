import { Prisma } from '@prisma/client';

/**
 * Motor de promocoes: calculo puro, sem banco e sem I/O.
 *
 * Fica separado do service de proposito. Desconto e dinheiro: a regra precisa
 * ser exercitavel isoladamente, e o servidor tem de conseguir recalcular o
 * mesmo numero na simulacao (o que o PDV mostra) e no fechamento da venda (o
 * que vale). Se as duas contas divergirem, o cliente ve um preco e paga outro.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** Arredonda para 2 casas, meio para cima — o mesmo criterio do resto da venda. */
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type PromotionKind =
  | 'PERCENT'
  | 'AMOUNT'
  | 'FIXED_PRICE'
  | 'BUY_X_PAY_Y';
export type PromotionScope = 'PRODUCT' | 'CATEGORY' | 'ALL';

export interface PromotionRule {
  id: string;
  name: string;
  kind: PromotionKind;
  scope: PromotionScope;
  productId: string | null;
  categoryId: string | null;
  value: Prisma.Decimal | null;
  buyQty: number | null;
  payQty: number | null;
  minQuantity: Prisma.Decimal | null;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  active: boolean;
}

export interface CartLine {
  productId: string;
  categoryId: string | null;
  /** Preco de catalogo. Nunca vem do cliente. */
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
  /** UNIT ou WEIGHT: "leve 3 pague 2" nao faz sentido em item pesado. */
  pricingMode: 'UNIT' | 'WEIGHT';
}

export interface LineDiscount {
  /** Posicao da linha no carrinho — o mesmo produto pode aparecer duas vezes. */
  index: number;
  productId: string;
  /** Desconto em R$ para a linha inteira (nao por unidade). */
  discount: Prisma.Decimal;
  promotionId: string;
  promotionName: string;
}

/** A regra alcanca esta linha? */
function reaches(rule: PromotionRule, line: CartLine): boolean {
  if (rule.scope === 'ALL') return true;
  if (rule.scope === 'PRODUCT') return rule.productId === line.productId;
  return rule.categoryId !== null && rule.categoryId === line.categoryId;
}

/** A regra esta vigente no instante informado? */
export function isLive(rule: PromotionRule, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.startsAt && at < rule.startsAt) return false;
  if (rule.endsAt && at > rule.endsAt) return false;
  return true;
}

/**
 * Desconto que a regra produz nesta linha, ja limitado ao valor bruto —
 * promocao nunca gera credito. Devolve zero quando a regra nao se aplica.
 */
function discountFor(rule: PromotionRule, line: CartLine): Prisma.Decimal {
  const gross = money(line.unitPrice.times(line.quantity));
  if (gross.lte(ZERO)) return ZERO;

  if (rule.minQuantity && line.quantity.lt(rule.minQuantity)) return ZERO;

  let raw = ZERO;
  switch (rule.kind) {
    case 'PERCENT': {
      if (!rule.value) return ZERO;
      raw = gross.times(rule.value).dividedBy(100);
      break;
    }
    case 'AMOUNT': {
      if (!rule.value) return ZERO;
      raw = rule.value.times(line.quantity);
      break;
    }
    case 'FIXED_PRICE': {
      if (!rule.value) return ZERO;
      const perUnit = line.unitPrice.minus(rule.value);
      if (perUnit.lte(ZERO)) return ZERO; // promocao nao encarece
      raw = perUnit.times(line.quantity);
      break;
    }
    case 'BUY_X_PAY_Y': {
      // So faz sentido em item contado. Peso nao tem "unidade gratis".
      if (line.pricingMode !== 'UNIT') return ZERO;
      const buy = rule.buyQty ?? 0;
      const pay = rule.payQty ?? 0;
      if (buy <= 0 || pay < 0 || pay >= buy) return ZERO;
      const blocks = line.quantity.dividedBy(buy).floor();
      const free = blocks.times(buy - pay);
      raw = free.times(line.unitPrice);
      break;
    }
  }

  const capped = raw.gt(gross) ? gross : raw;
  return capped.lte(ZERO) ? ZERO : money(capped);
}

/**
 * Escolhe UMA promocao por linha e devolve o desconto dela.
 *
 * Promocoes nao se acumulam entre si: acumular e como o varejo se machuca
 * (duas regras de 50% zeram o item). Ganha a de maior `priority`; empatou,
 * ganha a que da o maior desconto para o cliente.
 */
export function bestForLine(
  rules: PromotionRule[],
  line: CartLine,
  at: Date,
  index = 0,
): LineDiscount | null {
  let winner: { rule: PromotionRule; discount: Prisma.Decimal } | null = null;

  for (const rule of rules) {
    if (!isLive(rule, at)) continue;
    if (!reaches(rule, line)) continue;
    const discount = discountFor(rule, line);
    if (discount.lte(ZERO)) continue;

    if (
      !winner ||
      rule.priority > winner.rule.priority ||
      (rule.priority === winner.rule.priority && discount.gt(winner.discount))
    ) {
      winner = { rule, discount };
    }
  }

  if (!winner) return null;
  return {
    index,
    productId: line.productId,
    discount: winner.discount,
    promotionId: winner.rule.id,
    promotionName: winner.rule.name,
  };
}

export interface AppliedPromotions {
  /** Uma entrada por linha que ganhou desconto, na ordem do carrinho. */
  lines: LineDiscount[];
  total: Prisma.Decimal;
}

/** Aplica o motor ao carrinho inteiro. */
export function applyPromotions(
  rules: PromotionRule[],
  cart: CartLine[],
  at: Date = new Date(),
): AppliedPromotions {
  const lines: LineDiscount[] = [];
  let total = ZERO;

  for (const [index, line] of cart.entries()) {
    const best = bestForLine(rules, line, at, index);
    if (best) {
      lines.push(best);
      total = total.plus(best.discount);
    }
  }

  return { lines, total: money(total) };
}
