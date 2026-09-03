import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 nao carrega mais o .env automaticamente quando ha prisma.config.ts.
process.loadEnvFile(path.join(__dirname, '.env'));

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});
