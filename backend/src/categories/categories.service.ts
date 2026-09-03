import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoria nao encontrada.');
    return category;
  }

  create(dto: CategoryDto) {
    return this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId ?? null },
    });
  }

  async update(id: string, dto: CategoryDto) {
    await this.findOne(id);
    return this.prisma.category.update({
      where: { id },
      data: { name: dto.name, parentId: dto.parentId ?? null },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.category.delete({ where: { id } });
    return { message: 'Categoria removida.' };
  }
}
