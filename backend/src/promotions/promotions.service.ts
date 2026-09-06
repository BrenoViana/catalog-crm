import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyPromotions,
  type CartLine,
  type PromotionRule,
} from './promotion-engine';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ CRUD

  list() {
    return this.prisma.promotion.findMany({
      orderBy: [{ active: 'desc' }, { priority: 'desc' }, { name: 'asc' }],
      include: {
        product: { select: { id: true, name: true, sku: true } },
        category: { select: { id: true, name: true } },
      },
    });
  }

  async create(dto: CreatePromotionDto) {
    this.assertCoherent(dto);
    return this.prisma.promotion.create({ data: this.toData(dto) });
  }

  /** Linha crua, para a trilha registrar o antes e o depois. */
  findRaw(id: string) {
    return this.prisma.promotion.findUnique({ where: { id } });
  }

  /**
   * Atualizacao parcial: o que nao vem no corpo fica como esta.
   *
   * A coerencia e validada sobre o ESTADO FINAL, nao sobre o pedaco enviado —
   * senao um PATCH so com `kind` deixaria a regra sem o valor que ela exige.
   */
  async update(id: string, dto: UpdatePromotionDto) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promocao nao encontrada.');

    // `PartialType` do Nest reaplica `@IsOptional()` em todo campo herdado, e
    // `IsOptional` PULA a validacao quando o valor e `null`. Ou seja: o decorator
    // sozinho nao segura `{"value": null}`. A barreira tem de estar aqui.
    // Sem ela o merge devolvia 200 mantendo o desconto antigo (SEC-034).
    const NAO_ANULAVEIS = [
      'name',
      'kind',
      'scope',
      'value',
      'buyQty',
      'payQty',
      'priority',
      'active',
    ] as const;
    for (const campo of NAO_ANULAVEIS) {
      if (campo in dto && (dto as Record<string, unknown>)[campo] === null) {
        throw new BadRequestException(
          `O campo "${campo}" nao pode ser nulo. Envie um valor ou omita o campo.`,
        );
      }
    }

    const num = (v: Prisma.Decimal | null) => (v === null ? undefined : Number(v));
    // `undefined` = nao veio no corpo, mantem o que esta.
    // `null` = veio explicitamente vazio, LIMPA o campo.
    // Sem essa distincao, esvaziar "termina em" na tela nao removia a data
    // (SEC-036) e a campanha continuava morrendo na data antiga.
    const manter = <T,>(enviado: T | null | undefined, atual: T | undefined) =>
      enviado === undefined ? atual : (enviado ?? undefined);

    const merged: CreatePromotionDto = {
      name: dto.name ?? existing.name,
      description: manter(dto.description, existing.description ?? undefined),
      kind: dto.kind ?? (existing.kind as CreatePromotionDto['kind']),
      scope: dto.scope ?? (existing.scope as CreatePromotionDto['scope']),
      productId: dto.productId ?? existing.productId ?? undefined,
      categoryId: dto.categoryId ?? existing.categoryId ?? undefined,
      value: dto.value ?? num(existing.value),
      buyQty: dto.buyQty ?? existing.buyQty ?? undefined,
      payQty: dto.payQty ?? existing.payQty ?? undefined,
      minQuantity: manter(dto.minQuantity, num(existing.minQuantity)),
      startsAt: manter(dto.startsAt, existing.startsAt?.toISOString()),
      endsAt: manter(dto.endsAt, existing.endsAt?.toISOString()),
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
    };
    this.assertCoherent(merged);
    return this.prisma.promotion.update({ where: { id }, data: this.toData(merged) });
  }

  async remove(id: string) {
    const existing = await this.prisma.promotion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promocao nao encontrada.');
    await this.prisma.promotion.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------- aplicacao

  /** Regras vigentes agora, no formato que o motor entende. */
  async liveRules(at: Date = new Date()): Promise<PromotionRule[]> {
    const rows = await this.prisma.promotion.findMany({
      where: {
        active: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
        ],
      },
    });
    return rows as unknown as PromotionRule[];
  }

  /**
   * Desconto promocional de um carrinho. Usado pela simulacao do PDV e pelo
   * fechamento da venda — a mesma funcao nos dois lados, para o cliente nunca
   * ver um numero e pagar outro.
   */
  async computeFor(
    items: { productId: string; quantity: Prisma.Decimal | number }[],
    at: Date = new Date(),
  ) {
    if (items.length === 0) {
      return { lines: [], total: D(0), rules: [] as PromotionRule[] };
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
      select: {
        id: true,
        price: true,
        categoryId: true,
        pricingMode: true,
        active: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // Uma entrada por item do pedido, na MESMA ordem: o indice e o que liga o
    // desconto de volta a linha da venda (o mesmo produto pode repetir).
    // Produto inexistente vira linha neutra — quem recusa e o SalesService.
    const cart: CartLine[] = items.map((item) => {
      const product = byId.get(item.productId);
      return {
        productId: item.productId,
        categoryId: product?.categoryId ?? null,
        unitPrice: product ? D(product.price) : D(0),
        quantity: D(item.quantity),
        pricingMode: (product?.pricingMode ?? 'UNIT') as 'UNIT' | 'WEIGHT',
      };
    });

    const rules = await this.liveRules(at);
    const applied = applyPromotions(rules, cart, at);
    return { ...applied, rules };
  }

  /**
   * Variante usada pelo fechamento da venda: recebe o carrinho ja montado, com
   * os precos que a venda leu. Evita a SEGUNDA leitura de `Product.price` —
   * duas leituras fora de transacao podiam divergir se alguem alterasse o preco
   * no meio, e o desconto era calculado sobre um preco que a venda nao usou.
   */
  async computeForCart(cart: CartLine[], at: Date = new Date()) {
    return applyPromotions(await this.liveRules(at), cart, at);
  }

  /** Retorno da simulacao para o PDV. */
  async simulate(items: { productId: string; quantity: number }[]) {
    const { lines, total } = await this.computeFor(items);
    return {
      total: total.toNumber(),
      lines: lines.map((l) => ({
        index: l.index,
        productId: l.productId,
        discount: l.discount.toNumber(),
        promotionId: l.promotionId,
        promotionName: l.promotionName,
      })),
    };
  }

  // ------------------------------------------------------------------ apoio

  /**
   * Combinacoes que nao fazem sentido viram 400 aqui, e nao um desconto errado
   * no balcao seis meses depois.
   */
  private assertCoherent(dto: CreatePromotionDto) {
    if (dto.scope === 'PRODUCT' && !dto.productId) {
      throw new BadRequestException('Promocao por produto exige productId.');
    }
    if (dto.scope === 'CATEGORY' && !dto.categoryId) {
      throw new BadRequestException('Promocao por categoria exige categoryId.');
    }
    if (dto.kind === 'BUY_X_PAY_Y') {
      if (!dto.buyQty || dto.payQty === undefined || dto.payQty === null) {
        throw new BadRequestException('Leve/pague exige buyQty e payQty.');
      }
      if (dto.payQty >= dto.buyQty) {
        throw new BadRequestException('Em leve/pague, payQty precisa ser menor que buyQty.');
      }
    } else {
      if (dto.value === undefined || dto.value === null) {
        throw new BadRequestException('Esta promocao exige um valor.');
      }
      if (dto.kind === 'PERCENT' && (dto.value <= 0 || dto.value > 100)) {
        throw new BadRequestException('Percentual precisa ficar entre 0 e 100.');
      }
      if (dto.kind !== 'PERCENT' && dto.value <= 0) {
        throw new BadRequestException('O valor precisa ser maior que zero.');
      }
    }
    if (dto.startsAt && dto.endsAt && new Date(dto.startsAt) > new Date(dto.endsAt)) {
      throw new BadRequestException('O inicio da vigencia e depois do fim.');
    }
  }

  private toData(dto: CreatePromotionDto): Prisma.PromotionUncheckedCreateInput {
    return {
      name: dto.name,
      description: dto.description ?? null,
      kind: dto.kind,
      scope: dto.scope,
      productId: dto.scope === 'PRODUCT' ? (dto.productId ?? null) : null,
      categoryId: dto.scope === 'CATEGORY' ? (dto.categoryId ?? null) : null,
      value: dto.value !== undefined && dto.value !== null ? D(dto.value) : null,
      buyQty: dto.kind === 'BUY_X_PAY_Y' ? (dto.buyQty ?? null) : null,
      payQty: dto.kind === 'BUY_X_PAY_Y' ? (dto.payQty ?? null) : null,
      minQuantity:
        dto.minQuantity !== undefined && dto.minQuantity !== null
          ? D(dto.minQuantity)
          : null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
    };
  }
}
