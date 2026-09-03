import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImportProductsDto } from './dto/import-products.dto';
import { normalizeHeader, parseCsv, parseDecimal } from './csv.util';

const MAX_ROWS = 5000;

/** Cabecalho do CSV -> campo interno. Aceita nomes em pt e en. */
const COLUMN_ALIASES: Record<string, string> = {
  sku: 'sku',
  codigo: 'sku',
  'codigo interno': 'sku',
  name: 'name',
  nome: 'name',
  descricao: 'description',
  description: 'description',
  barcode: 'barcode',
  ean: 'barcode',
  'codigo de barras': 'barcode',
  unit: 'unit',
  unidade: 'unit',
  un: 'unit',
  price: 'price',
  preco: 'price',
  'preco de venda': 'price',
  valor: 'price',
  cost: 'cost',
  custo: 'cost',
  'preco de custo': 'cost',
  category: 'category',
  categoria: 'category',
  stock: 'stock',
  estoque: 'stock',
  'estoque inicial': 'stock',
  quantidade: 'stock',
  minstock: 'minStock',
  'estoque minimo': 'minStock',
  minimo: 'minStock',
};

type RowAction = 'created' | 'updated' | 'error';

export interface ImportRowResult {
  line: number;
  sku: string;
  action: RowAction;
  message?: string;
}

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  errors: number;
  rows: ImportRowResult[];
}

@Injectable()
export class ProductsImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(dto: ImportProductsDto): Promise<ImportResult> {
    const table = parseCsv(dto.csv);
    if (table.length < 2) {
      throw new BadRequestException(
        'CSV precisa de uma linha de cabecalho e ao menos uma linha de dados.',
      );
    }
    if (table.length - 1 > MAX_ROWS) {
      throw new BadRequestException(
        `Importacao limitada a ${MAX_ROWS} linhas por vez (recebidas ${table.length - 1}).`,
      );
    }

    const header = table[0].map(
      (h) => COLUMN_ALIASES[normalizeHeader(h)] ?? normalizeHeader(h),
    );
    const idx = (field: string) => header.indexOf(field);

    for (const required of ['sku', 'name', 'price']) {
      if (idx(required) === -1) {
        throw new BadRequestException(
          `Coluna obrigatoria ausente no cabecalho: "${required}". Colunas lidas: ${header.join(', ')}.`,
        );
      }
    }

    const categoryCache = await this.loadCategories();
    const createCategories = dto.createCategories !== false;

    const rows: ImportRowResult[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 1; i < table.length; i++) {
      const cells = table[i];
      const line = i + 1; // 1-based, contando o cabecalho
      const get = (field: string) => {
        const at = idx(field);
        return at === -1 ? '' : (cells[at] ?? '').trim();
      };
      const sku = get('sku');

      try {
        if (!sku) throw new Error('SKU vazio.');
        const name = get('name');
        if (!name) throw new Error('Nome vazio.');

        const price = parseDecimal(get('price'));
        if (price === null || price < 0) {
          throw new Error(`Preco invalido: "${get('price')}".`);
        }

        const costRaw = get('cost');
        const cost = costRaw ? parseDecimal(costRaw) : null;
        if (costRaw && (cost === null || cost < 0)) {
          throw new Error(`Custo invalido: "${costRaw}".`);
        }

        const stockRaw = get('stock');
        const stock = stockRaw ? parseDecimal(stockRaw) : null;
        if (stockRaw && (stock === null || stock < 0)) {
          throw new Error(`Estoque invalido: "${stockRaw}".`);
        }
        const minStockRaw = get('minStock');
        const minStock = minStockRaw ? parseDecimal(minStockRaw) : null;
        if (minStockRaw && (minStock === null || minStock < 0)) {
          throw new Error(`Estoque minimo invalido: "${minStockRaw}".`);
        }

        const categoryName = get('category');
        let categoryId: string | null = null;
        if (categoryName) {
          categoryId = categoryCache.get(categoryName.toLowerCase()) ?? null;
          if (!categoryId) {
            if (!createCategories) {
              throw new Error(`Categoria "${categoryName}" nao existe.`);
            }
            const cat = await this.prisma.category.create({
              data: { name: categoryName },
            });
            categoryCache.set(categoryName.toLowerCase(), cat.id);
            categoryId = cat.id;
          }
        }

        const existing = await this.prisma.product.findUnique({
          where: { sku },
          select: { id: true },
        });

        const common = {
          name,
          barcode: get('barcode') || null,
          description: get('description') || null,
          price: new Prisma.Decimal(price),
          cost: cost === null ? null : new Prisma.Decimal(cost),
          categoryId,
        };

        if (existing) {
          await this.prisma.product.update({
            where: { id: existing.id },
            data: {
              ...common,
              unit: get('unit') || undefined,
              // Saldo de estoque nao e sobrescrito na reimportacao (e movimento).
              stock:
                minStock !== null
                  ? {
                      upsert: {
                        create: {
                          quantity: new Prisma.Decimal(0),
                          minQuantity: new Prisma.Decimal(minStock),
                        },
                        update: { minQuantity: new Prisma.Decimal(minStock) },
                      },
                    }
                  : undefined,
            },
          });
          updated++;
          rows.push({
            line,
            sku,
            action: 'updated',
            message: stockRaw
              ? 'Atualizado (saldo de estoque ignorado — use a tela de Estoque).'
              : undefined,
          });
        } else {
          await this.prisma.product.create({
            data: {
              ...common,
              sku,
              unit: get('unit') || 'UN',
              stock: {
                create: {
                  quantity: new Prisma.Decimal(stock ?? 0),
                  minQuantity: new Prisma.Decimal(minStock ?? 0),
                },
              },
            },
          });
          created++;
          rows.push({ line, sku, action: 'created' });
        }
      } catch (err) {
        rows.push({
          line,
          sku,
          action: 'error',
          message: err instanceof Error ? err.message : 'Erro desconhecido.',
        });
      }
    }

    return {
      total: table.length - 1,
      created,
      updated,
      errors: rows.filter((r) => r.action === 'error').length,
      rows,
    };
  }

  private async loadCategories() {
    const cats = await this.prisma.category.findMany({
      select: { id: true, name: true },
    });
    return new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  }
}
