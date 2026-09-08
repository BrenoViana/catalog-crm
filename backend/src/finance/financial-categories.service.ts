import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type FinancialCategoryKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFinancialCategoryDto,
  UpdateFinancialCategoryDto,
} from './dto/finance.dto';

/** Profundidade maxima da arvore. Plano de contas de varejo raramente passa de
 *  tres niveis; o teto evita arvore degenerada e recursao sem fim no monte. */
const MAX_DEPTH = 4;

export interface CategoryNode {
  id: string;
  kind: FinancialCategoryKind;
  name: string;
  code: string | null;
  parentId: string | null;
  active: boolean;
  children: CategoryNode[];
}

/**
 * Plano de contas gerencial: uma arvore de RECEITA e uma de DESPESA.
 *
 * O `kind` de um no e herdado do pai — nao da para pendurar uma conta de
 * despesa numa raiz de receita. Categoria com filho ativo ou com titulo aberto
 * vinculado nao arquiva: sumiria a classificacao de um compromisso vivo.
 */
@Injectable()
export class FinancialCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Arvore completa, opcionalmente so de um `kind`. */
  async tree(kind?: FinancialCategoryKind): Promise<CategoryNode[]> {
    const rows = await this.prisma.financialCategory.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ name: 'asc' }],
    });

    const byId = new Map<string, CategoryNode>();
    for (const r of rows) {
      byId.set(r.id, {
        id: r.id,
        kind: r.kind,
        name: r.name,
        code: r.code,
        parentId: r.parentId,
        active: r.active,
        children: [],
      });
    }

    const roots: CategoryNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async create(dto: CreateFinancialCategoryDto) {
    let kind: FinancialCategoryKind | undefined = dto.kind as
      | FinancialCategoryKind
      | undefined;
    if (dto.parentId) {
      const parent = await this.prisma.financialCategory.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new NotFoundException('Categoria pai não encontrada.');
      if (dto.kind && (dto.kind as string) !== parent.kind) {
        throw new BadRequestException(
          'A categoria filha herda a natureza (receita/despesa) da categoria pai.',
        );
      }
      kind = parent.kind;
      if ((await this.depthOf(parent.id)) + 1 >= MAX_DEPTH) {
        throw new BadRequestException(
          `O plano de contas aceita no máximo ${MAX_DEPTH} níveis.`,
        );
      }
    }
    if (!kind) {
      throw new BadRequestException(
        'Informe a natureza (receita/despesa) ou uma categoria pai.',
      );
    }

    return this.prisma.financialCategory
      .create({
        data: {
          kind,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          parentId: dto.parentId ?? null,
        },
      })
      .catch((e) => {
        // So a colisao de unico vira "ja existe"; qualquer outra falha sobe
        // como esta, para nao mandar o usuario renomear o que nao e o problema
        // (SEC-106).
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new BadRequestException(
            'Já existe uma categoria com esse nome no mesmo nível.',
          );
        }
        throw e;
      });
  }

  /** Devolve `{ before, after }` para a trilha gravar de/para (SEC-098). */
  async update(id: string, dto: UpdateFinancialCategoryDto) {
    const before = await this.get(id);
    const after = await this.prisma.financialCategory.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.code === undefined ? {} : { code: dto.code?.trim() || null }),
      },
    });
    return { before, after };
  }

  async archive(id: string) {
    await this.get(id);
    const [activeChildren, openTitles] = await Promise.all([
      this.prisma.financialCategory.count({
        where: { parentId: id, active: true },
      }),
      this.prisma.payable.count({
        where: { financialCategoryId: id, status: { in: ['ABERTO', 'PARCIAL'] } },
      }),
    ]);
    if (activeChildren > 0) {
      throw new BadRequestException(
        'Arquive ou mova as subcategorias antes de arquivar esta.',
      );
    }
    if (openTitles > 0) {
      throw new BadRequestException(
        'Há títulos em aberto classificados nesta categoria.',
      );
    }
    return this.prisma.financialCategory.update({
      where: { id },
      data: { active: false },
    });
  }

  /** Valida que a categoria existe, esta ativa e e do `kind` esperado. */
  async assertUsable(id: string, expected: FinancialCategoryKind) {
    const cat = await this.get(id);
    if (!cat.active) throw new BadRequestException('Categoria arquivada.');
    if (cat.kind !== expected) {
      throw new BadRequestException(
        expected === 'DESPESA'
          ? 'Escolha uma categoria de despesa.'
          : 'Escolha uma categoria de receita.',
      );
    }
    return cat;
  }

  private async get(id: string) {
    const cat = await this.prisma.financialCategory.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Categoria não encontrada.');
    return cat;
  }

  private async depthOf(id: string): Promise<number> {
    let depth = 0;
    let current: string | null = id;
    while (current && depth < MAX_DEPTH + 2) {
      const row = await this.prisma.financialCategory.findUnique({
        where: { id: current },
        select: { parentId: true },
      });
      if (!row) break;
      depth += 1;
      current = row.parentId;
    }
    return depth;
  }
}
