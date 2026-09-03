import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GERENTE/ADMIN veem a lista completa. OPERADOR so recebe resultado ao
   * informar um termo de busca (>= 3 caracteres) e com campos reduzidos —
   * evita expor a base inteira de clientes (CPF, e-mail, nascimento) no PDV.
   */
  findAll(search: string | undefined, role: Role) {
    const isManager = role === Role.ADMIN || role === Role.GERENTE;
    const term = (search ?? '').trim();

    if (!isManager && term.length < 3) return [];

    const where = term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { document: { contains: term } },
            { phone: { contains: term } },
          ],
        }
      : undefined;

    return this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 100,
      ...(isManager
        ? {}
        : {
            select: { id: true, name: true, document: true, phone: true },
          }),
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente nao encontrado.');
    return customer;
  }

  create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        name: dto.name,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Cliente removido.' };
  }
}
