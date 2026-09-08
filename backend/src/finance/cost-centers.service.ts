import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CostCenterDto } from './dto/finance.dto';

/** Converte a colisao de unico do Postgres numa mensagem util, sem mascarar
 *  qualquer outra falha (queda de conexao, FK) como "ja existe" (SEC-106). */
function asDuplicate(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new BadRequestException('Já existe um centro de custo com esse nome.');
  }
  throw e;
}

/**
 * Centros de custo: por qual area/departamento a receita ou a despesa responde.
 * Cadastro simples e plano (sem hierarquia) — o que da o recorte gerencial e o
 * cruzamento com o plano de contas, nao a profundidade do proprio centro.
 */
@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  list(includeArchived = false) {
    return this.prisma.costCenter.findMany({
      where: includeArchived ? undefined : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  create(dto: CostCenterDto) {
    return this.prisma.costCenter
      .create({
        data: { name: dto.name.trim(), code: dto.code?.trim() || null },
      })
      .catch(asDuplicate);
  }

  /** Devolve `{ before, after }` para a trilha gravar de/para (SEC-098). */
  async update(id: string, dto: CostCenterDto) {
    const before = await this.get(id);
    const after = await this.prisma.costCenter
      .update({
        where: { id },
        data: {
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
        },
      })
      .catch(asDuplicate);
    return { before, after };
  }

  async archive(id: string) {
    await this.get(id);
    return this.prisma.costCenter.update({
      where: { id },
      data: { active: false },
    });
  }

  async assertUsable(id: string) {
    const cc = await this.get(id);
    if (!cc.active) throw new BadRequestException('Centro de custo arquivado.');
    return cc;
  }

  private async get(id: string) {
    const cc = await this.prisma.costCenter.findUnique({ where: { id } });
    if (!cc) throw new NotFoundException('Centro de custo não encontrado.');
    return cc;
  }
}
