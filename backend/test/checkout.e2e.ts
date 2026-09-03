/**
 * E2E do fluxo de balcao: abrir caixa -> vender -> pagar -> (cancelar) -> fechar.
 *
 * Sobe a aplicacao NestJS real (HTTP + guards + validacao + banco) numa porta
 * efemera e exercita o caminho critico do PDV via HTTP, como o frontend faz.
 *
 * Pre-requisitos:
 *   - Banco de desenvolvimento no ar (`npm run db` / `prisma dev`).
 *   - Seed aplicado (usuario admin/admin).
 *   - O caixa do usuario `admin` NAO pode estar aberto (o teste abre e fecha um).
 *
 * Rodar:  npm run test:e2e   (dentro de backend/)
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { DecimalInterceptor } from '../src/common/decimal.interceptor';

const envPath = path.join(__dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${label}`);
}

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new DecimalInterceptor());
  await app.listen(0);

  const { port } = app.getHttpServer().address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/api`;

  let token = '';
  const api = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, body: json as any };
  };

  const sku = `E2E-${Date.now()}`;
  let productId = '';
  let saleId = '';

  try {
    // 1) Login
    const login = await api('POST', '/auth/login', {
      username: 'admin',
      password: 'admin',
    });
    check('login admin -> 201 + token', () => {
      assert.equal(login.status, 201);
      assert.ok(login.body.access_token, 'sem access_token');
    });
    token = login.body.access_token;

    // 2) Pre-condicao: caixa do admin fechado
    const pre = await api('GET', '/cash/current');
    check('nenhum caixa aberto para o admin (pre-condicao)', () => {
      assert.equal(
        pre.body,
        null,
        'Feche o caixa do admin antes de rodar o e2e.',
      );
    });

    // 3) Produto descartavel para a venda
    const create = await api('POST', '/products', {
      sku,
      name: `Produto E2E ${sku}`,
      price: 10,
      unit: 'UN',
      initialStock: 5,
      minStock: 1,
    });
    check('cria produto de teste (estoque 5)', () => {
      assert.equal(create.status, 201);
      assert.equal(create.body.stock.quantity, 5);
    });
    productId = create.body.id;

    // 4) Abrir caixa com fundo de R$ 100
    const open = await api('POST', '/cash/open', { openingAmount: 100 });
    check('abre caixa -> ABERTA, abertura 100', () => {
      assert.equal(open.status, 201);
      assert.equal(open.body.status, 'ABERTA');
      assert.equal(Number(open.body.openingAmount), 100);
    });

    // 5) Vender 2 un a R$ 10, pagas em dinheiro (R$ 20)
    const sale = await api('POST', '/sales', {
      items: [{ productId, quantity: 2 }],
      payments: [{ method: 'DINHEIRO', amount: 20 }],
    });
    check('registra venda -> CONCLUIDA, total 20', () => {
      assert.equal(sale.status, 201);
      assert.equal(sale.body.status, 'CONCLUIDA');
      assert.equal(Number(sale.body.total), 20);
      assert.ok(sale.body.number > 0, 'venda sem numero');
    });
    saleId = sale.body.id;

    // 6) Caixa: dinheiro da venda entrou (100 + 20 = 120)
    const afterSale = await api('GET', '/cash/current');
    check('saldo esperado do caixa = 120 apos a venda', () => {
      assert.equal(Number(afterSale.body.expectedAmount), 120);
      assert.ok(
        afterSale.body.movements.some(
          (m: any) => m.type === 'VENDA' && Number(m.amount) === 20,
        ),
        'sem movimento VENDA de 20 no caixa',
      );
    });

    // 7) Estoque baixou 2 -> 3
    const stockDown = await api('GET', `/products/${productId}`);
    check('estoque do produto baixou para 3', () => {
      assert.equal(Number(stockDown.body.stock.quantity), 3);
    });

    // 8) Cancelar a venda (caixa ainda aberto)
    const cancel = await api('POST', `/sales/${saleId}/cancel`, {
      reason: 'e2e cleanup',
    });
    check('cancela venda -> CANCELADA', () => {
      assert.ok([200, 201].includes(cancel.status));
      assert.equal(cancel.body.status, 'CANCELADA');
    });

    // 9) Estoque restaurado para 5
    const stockBack = await api('GET', `/products/${productId}`);
    check('estoque volta para 5 apos o cancelamento', () => {
      assert.equal(Number(stockBack.body.stock.quantity), 5);
    });

    // 10) Caixa: dinheiro estornado (120 - 20 = 100)
    const afterCancel = await api('GET', '/cash/current');
    check('saldo esperado volta a 100 (estorno em caixa)', () => {
      assert.equal(Number(afterCancel.body.expectedAmount), 100);
      assert.ok(
        afterCancel.body.movements.some(
          (m: any) => m.type === 'SANGRIA' && Number(m.amount) === 20,
        ),
        'sem SANGRIA de estorno no caixa',
      );
    });

    // 11) Fechar caixa contando R$ 100 -> diferenca 0
    const close = await api('POST', '/cash/close', { countedAmount: 100 });
    check('fecha caixa -> FECHADA, esperado 100, diferenca 0', () => {
      assert.equal(close.status, 201);
      assert.equal(close.body.status, 'FECHADA');
      assert.equal(Number(close.body.closingExpectedAmount), 100);
      assert.equal(Number(close.body.difference), 0);
    });
  } finally {
    // Limpeza best-effort: inativa o produto de teste.
    if (productId && token) {
      await api('DELETE', `/products/${productId}`).catch(() => undefined);
    }
    await app.close();
  }

  console.log(`\n${passed} verificacoes OK — fluxo de caixa integro.`);
}

main().catch((err) => {
  console.error('\nE2E FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
