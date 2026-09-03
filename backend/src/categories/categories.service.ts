import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true, children: true } } },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoria nao encontrada.');
    return category;
  }

  async create(dto: CategoryDto) {
    if (dto.parentId) await this.findOne(dto.parentId);
    return this.prisma.category.create({
      data: { name: dto.name.trim(), parentId: dto.parentId ?? null },
    });
  }

  async update(id: string, dto: CategoryDto) {
    await this.findOne(id);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Uma categoria nao pode ser pai dela mesma.');
      }
      await this.findOne(dto.parentId);
      await this.assertNotDescendant(id, dto.parentId);
    }

    return this.prisma.category.update({
      where: { id },
      data: { name: dto.name.trim(), parentId: dto.parentId ?? null },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    const [products, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);

    if (products > 0) {
      throw new BadRequestException(
        `Categoria tem ${products} produto(s). Mova-os para outra categoria antes de remover.`,
      );
    }
    if (children > 0) {
      throw new BadRequestException(
        `Categoria tem ${children} subcategoria(s). Remova-as antes.`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    return { message: 'Categoria removida.' };
  }

  /**
   * Impede ciclo na arvore: o novo pai nao pode estar abaixo da propria
   * categoria que esta sendo editada.
   */
  private async assertNotDescendant(id: string, parentId: string) {
    const seen = new Set<string>();
    let cursor: string | null = parentId;

    while (cursor) {
      if (cursor === id) {
        throw new BadRequestException(
          'Movimento invalido: o pai escolhido esta abaixo desta categoria.',
        );
      }
      if (seen.has(cursor)) break; // arvore ja corrompida; nao entrar em loop
      seen.add(cursor);

      const parent = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }
}
