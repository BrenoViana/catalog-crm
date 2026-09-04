import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL as string,
        // O `prisma dev` local publica connection_limit=10 no total. Com o
        // servidor no ar mais um e2e (ou um script) rodando ao lado, um pool
        // grande esgota o limite e o Postgres passa a fechar conexao na cara
        // do cliente (P1017 ConnectionClosed). 4 deixa folga para os dois.
        max: Number(process.env.DATABASE_POOL_MAX ?? 4),
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
