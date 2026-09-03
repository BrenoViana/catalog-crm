import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSellerDto } from './dto/create-seller.dto';

@Injectable()
export class SellersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.seller.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: CreateSellerDto) {
    return this.prisma.seller.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
        salesTarget: dto.salesTarget ?? 0,
        commissionRate: dto.commissionRate ?? 0,
      },
    });
  }
}
