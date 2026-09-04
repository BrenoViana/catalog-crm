import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: { search?: string; categoryId?: string; onlyActive?: boolean }) {
    const { categoryId, onlyActive } = params;
    const term = params.search?.trim();

    // Busca textual: usa os indices trigram (ver migration terminal_pricing_mode).
    // immutable_unaccent() tolera acento; o operador % tolera erro de digitacao.
    if (term && term.length >= 2) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Product"
        WHERE (${onlyActive ?? null}::boolean IS NOT TRUE OR "active" = true)
          AND (${categoryId ?? null}::text IS NULL OR "categoryId" = ${categoryId ?? null})
          AND (
            immutable_unaccent(lower("name")) LIKE '%' || immutable_unaccent(lower(${term})) || '%'
            OR lower("sku") LIKE '%' || lower(${term}) || '%'
            OR "barcode" = ${term}
            OR immutable_unaccent(lower(${term})) <% immutable_unaccent(lower("name"))
          )
        ORDER BY
          word_similarity(immutable_unaccent(lower(${term})), immutable_unaccent(lower("name"))) DESC,
          "name" ASC
        LIMIT 50
      `;
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return [];

      const found = await this.prisma.product.findMany({
        where: { id: { in: ids } },
        include: { category: true, stock: true, taxGroup: true },
      });
      // findMany nao preserva a ordem do IN: reaplica a relevancia do SQL.
      const rank = new Map(ids.map((id, i) => [id, i]));
      return found.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }

    return this.prisma.product.findMany({
      where: {
        active: onlyActive ? true : undefined,
        categoryId: categoryId || undefined,
      },
      orderBy: { name: 'asc' },
      include: { category: true, stock: true, taxGroup: true },
    });
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true, stock: true, taxGroup: true },
    });
    if (!product) throw new NotFoundException('Produto nao encontrado.');
    return product;
  }

  /** Busca por codigo de barras ou SKU exato - usado pelo PDV. */
  async findByCode(code: string) {
    const product = await this.prisma.product.findFirst({
      where: { OR: [{ barcode: code }, { sku: code }] },
      include: { category: true, stock: true, taxGroup: true },
    });
    if (!product) throw new NotFoundException('Produto nao encontrado.');
    return product;
  }

  async create(dto: CreateProductDto) {
    const exists = await this.prisma.product.findUnique({ where: { sku: dto.sku } });
    if (exists) throw new BadRequestException('Ja existe um produto com este SKU.');

    return this.prisma.product.create({
      data: {
        sku: dto.sku,
        barcode: dto.barcode || null,
        name: dto.name,
        description: dto.description,
        unit: dto.unit ?? (dto.pricingMode === 'WEIGHT' ? 'KG' : 'UN'),
        pricingMode: dto.pricingMode ?? 'UNIT',
        price: dto.price,
        cost: dto.cost,
        imageUrl: dto.imageUrl,
        active: dto.active ?? true,
        categoryId: dto.categoryId ?? null,
        taxGroupId: dto.taxGroupId ?? null,
        stock: {
          create: {
            quantity: dto.initialStock ?? 0,
            minQuantity: dto.minStock ?? 0,
          },
        },
      },
      include: { category: true, stock: true },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: {
        sku: dto.sku,
        barcode: dto.barcode,
        name: dto.name,
        description: dto.description,
        unit: dto.unit,
        pricingMode: dto.pricingMode,
        price: dto.price,
        cost: dto.cost,
        imageUrl: dto.imageUrl,
        active: dto.active,
        categoryId: dto.categoryId,
        taxGroupId: dto.taxGroupId,
      },
      include: { category: true, stock: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Nao apaga (pode ter historico de venda): apenas inativa.
    await this.prisma.product.update({ where: { id }, data: { active: false } });
    return { message: 'Produto inativado.' };
  }

  listTaxGroups() {
    return this.prisma.taxGroup.findMany({ orderBy: { name: 'asc' } });
  }
}
