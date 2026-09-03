import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateLicenseDto } from './dto/update-license.dto';

@Injectable()
export class LicenseService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent() {
    const active = await this.prisma.license.findFirst({ where: { active: true } });
    return active ?? { key: '', customer: 'Cliente', active: false, updatedAt: new Date().toISOString() };
  }

  async update(dto: UpdateLicenseDto) {
    const active = await this.prisma.license.findFirst({ where: { active: true } });

    if (active) {
      await this.prisma.license.update({
        where: { id: active.id },
        data: { active: false },
      });
    }

    const updated = await this.prisma.license.upsert({
      where: { key: dto.key },
      update: {
        customer: dto.customer ?? 'Cliente',
        active: true,
      },
      create: {
        key: dto.key,
        customer: dto.customer ?? 'Cliente',
        active: true,
      },
    });

    return updated;
  }
}
