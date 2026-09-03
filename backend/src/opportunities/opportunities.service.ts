import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';

@Injectable()
export class OpportunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.opportunity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: true, seller: true },
    });
  }

  create(dto: CreateOpportunityDto) {
    return this.prisma.opportunity.create({
      data: {
        title: dto.title,
        customerId: dto.customerId,
        sellerId: dto.sellerId,
        stage: dto.stage,
        amount: dto.amount ?? 0,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        notes: dto.notes ?? '',
      },
      include: { customer: true, seller: true },
    });
  }
}
