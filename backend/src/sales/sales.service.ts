import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.sale.findMany({
      orderBy: { createdAt: 'desc' },
      include: { opportunity: true },
    });
  }

  create(dto: CreateSaleDto) {
    return this.prisma.sale.create({
      data: {
        opportunityId: dto.opportunityId,
        amount: dto.amount ?? 0,
        status: dto.status ?? 'PENDING',
      },
      include: { opportunity: true },
    });
  }
}
