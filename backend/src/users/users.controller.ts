import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Roles(Role.GERENTE)
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, name: true, role: true, createdAt: true },
    });
  }
}
