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
  const sku2 = `E2E-${Date.now()}-B`;
  let productId = '';
  let product2Id = '';
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

    // 2b) Dashboard responde 200 com os indicadores (varias consultas em paralelo).
    const dash = await api('GET', '/dashboard/summary');
    check('GET /dashboard/summary -> 200 com indicadores', () => {
      assert.equal(dash.status, 200);
      for (const key of [
        'revenueToday',
        'salesToday',
        'averageTicket',
        'salesLast7Days',
        'topProducts',
        'paymentsByMethod',
      ]) {
        assert.ok(key in dash.body, `dashboard sem "${key}"`);
      }
      assert.equal(dash.body.salesLast7Days.length, 7);
    });

    // 2c) Branding publico da loja (tela de login, sem token).
    const savedToken = token;
    token = '';
    const branding = await api('GET', '/store-settings/branding');
    token = savedToken;
    check('GET /store-settings/branding -> 200 sem autenticacao', () => {
      assert.equal(branding.status, 200);
      assert.ok('logoLightUrl' in branding.body, 'branding sem logoLightUrl');
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

    // 7-X) Leitura X do turno: 1 venda de 20, tudo em dinheiro.
    const readX = await api('GET', '/cash/report');
    check('leitura X -> 1 venda, 20 em dinheiro, esperado 120', () => {
      assert.equal(readX.body.kind, 'X');
      assert.equal(readX.body.sales.count, 1);
      assert.equal(Number(readX.body.sales.total), 20);
      assert.equal(Number(readX.body.cash.expected), 120);
      const cashRow = readX.body.byPaymentMethod.find(
        (r: any) => r.method === 'DINHEIRO',
      );
      assert.ok(cashRow && Number(cashRow.amount) === 20, 'sem linha DINHEIRO=20');
    });

    // 7a) NFC-e: a venda gerou um documento fiscal; forcar a emissao (idempotente)
    //     e conferir a autorizacao pelo provedor simulado.
    const withDoc = await api('GET', `/sales/${saleId}`);
    check('venda tem documento fiscal', () => {
      assert.ok(withDoc.body.fiscalDocument?.id, 'sem fiscalDocument na venda');
    });
    const fiscalId = withDoc.body.fiscalDocument.id;
    const emitted = await api('POST', `/fiscal/documents/${fiscalId}/emit`);
    check('documento fiscal AUTORIZADA com chave de 44 digitos + QR', () => {
      assert.ok([200, 201].includes(emitted.status));
      assert.equal(emitted.body.status, 'AUTORIZADA');
      assert.equal(String(emitted.body.accessKey).length, 44);
      assert.ok(emitted.body.qrCode, 'sem string de QR Code');
      assert.equal(emitted.body.provider, 'fake');
    });

    // 7b) Justificativa curta demais no cancelamento fiscal -> 400
    const badJustify = await api('POST', `/fiscal/documents/${fiscalId}/cancel`, {
      reason: 'curto',
    });
    check('cancelamento fiscal exige justificativa de 15+ chars -> 400', () => {
      assert.equal(badJustify.status, 400);
    });

    // 7d) Desconto por item + desconto na venda + pagamento dividido (sem dinheiro)
    const create2 = await api('POST', '/products', {
      sku: sku2,
      name: `Produto E2E ${sku2}`,
      price: 10,
      unit: 'UN',
      initialStock: 5,
      minStock: 1,
    });
    check('cria 2o produto de teste (estoque 5)', () => {
      assert.equal(create2.status, 201);
    });
    product2Id = create2.body.id;

    const splitSale = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 2, discount: 4 }],
      discount: 1,
      payments: [
        { method: 'PIX', amount: 10 },
        { method: 'DEBITO', amount: 5 },
      ],
    });
    check('venda com descontos + split -> subtotal 16, desconto 1, total 15', () => {
      assert.equal(splitSale.status, 201);
      assert.equal(Number(splitSale.body.subtotal), 16);
      assert.equal(Number(splitSale.body.discount), 1);
      assert.equal(Number(splitSale.body.total), 15);
      assert.equal(splitSale.body.payments.length, 2);
    });

    // 7e) Pagamento eletronico nao pode exceder o total (nao ha troco).
    const overpay = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 1 }],
      payments: [{ method: 'PIX', amount: 20 }],
    });
    check('PIX acima do total -> 400', () => {
      assert.equal(overpay.status, 400);
    });

    // 7f) Split nao mexe no caixa (nenhum pagamento em dinheiro).
    const afterSplit = await api('GET', '/cash/current');
    check('saldo do caixa segue 120 apos venda sem dinheiro', () => {
      assert.equal(Number(afterSplit.body.expectedAmount), 120);
    });

    // 7g) Politica de desconto: OPERADOR nao ultrapassa o teto da loja (10%).
    const adminToken = token;
    const opLogin = await api('POST', '/auth/login', {
      username: 'operador',
      password: 'operador',
    });
    const opToken = opLogin.body.access_token;
    token = opToken;
    const bigDiscount = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 1, discount: 3 }], // 30%
      payments: [{ method: 'PIX', amount: 7 }],
    });
    const okDiscount = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 1, discount: 0.5 }], // 5%
      payments: [{ method: 'PIX', amount: 9.5 }],
    });
    token = adminToken;
    check('operador com 30% de desconto -> 400 (acima do teto)', () => {
      assert.equal(bigDiscount.status, 400);
    });
    check('operador com 5% de desconto -> 201', () => {
      assert.equal(okDiscount.status, 201);
    });
    if (okDiscount.body?.id) {
      await api('POST', `/sales/${okDiscount.body.id}/cancel`, {
        reason: 'e2e cleanup desconto operador',
      });
    }

    // 7g-2) Devolucao parcial: vende 3, devolve 1, depois 2, e a 4a falha.
    token = opToken;
    const retSale = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 3 }],
      payments: [{ method: 'PIX', amount: 30 }],
    });
    const retItemId = retSale.body.items?.[0]?.id;
    const ret1 = await api('POST', `/sales/${retSale.body.id}/returns`, {
      items: [{ saleItemId: retItemId, quantity: 1 }],
      reason: 'produto com defeito',
      refundMethod: 'PIX',
    });
    const afterRet1 = await api('GET', `/products/${product2Id}`);
    const ret2 = await api('POST', `/sales/${retSale.body.id}/returns`, {
      items: [{ saleItemId: retItemId, quantity: 2 }],
      reason: 'cliente desistiu do restante',
      refundMethod: 'PIX',
    });
    const ret3 = await api('POST', `/sales/${retSale.body.id}/returns`, {
      items: [{ saleItemId: retItemId, quantity: 1 }],
      reason: 'nao deveria passar',
      refundMethod: 'PIX',
    });
    const saleWithReturns = await api('GET', `/sales/${retSale.body.id}`);
    token = adminToken;
    check('devolve 1 de 3 -> 201, reembolso 10, estoque volta 1', () => {
      assert.ok([200, 201].includes(ret1.status));
      assert.equal(Number(ret1.body.total), 10);
      assert.equal(ret1.body.items.length, 1);
      assert.equal(Number(afterRet1.body.stock.quantity), 1);
    });
    check('devolve os 2 restantes -> 201', () => {
      assert.ok([200, 201].includes(ret2.status));
      assert.equal(Number(ret2.body.total), 20);
    });
    check('devolver alem do vendido -> 400', () => {
      assert.equal(ret3.status, 400);
    });
    check('venda mantem CONCLUIDA com 2 devolucoes registradas', () => {
      assert.equal(saleWithReturns.body.status, 'CONCLUIDA');
      assert.equal(saleWithReturns.body.returns.length, 2);
    });

    // 7h) Cancela a venda com desconto e confere estoque de volta em 5.
    await api('POST', `/sales/${splitSale.body.id}/cancel`, { reason: 'e2e cleanup' });
    const stock2Back = await api('GET', `/products/${product2Id}`);
    check('estoque do 2o produto volta para 5 apos cancelamento', () => {
      assert.equal(Number(stock2Back.body.stock.quantity), 5);
    });

    // 8) Cancelar a venda (caixa ainda aberto)
    const cancel = await api('POST', `/sales/${saleId}/cancel`, {
      reason: 'e2e cleanup',
    });
    check('cancela venda -> CANCELADA', () => {
      assert.ok([200, 201].includes(cancel.status));
      assert.equal(cancel.body.status, 'CANCELADA');
    });

    // 8a) A NFC-e autorizada da venda tambem foi cancelada junto ao provedor.
    const canceledDoc = await api('GET', `/sales/${saleId}`);
    check('documento fiscal da venda cancelada -> CANCELADA', () => {
      assert.equal(canceledDoc.body.fiscalDocument.status, 'CANCELADA');
      assert.ok(canceledDoc.body.fiscalDocument.canceledAt, 'sem canceledAt');
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

    // 11-Z) Relatorio Z do turno fechado: vendas do turno canceladas, diferenca 0.
    const readZ = await api('GET', `/cash/report/${close.body.id}`);
    check('relatorio Z -> kind Z, 0 vendas ativas, 2 canceladas, diferenca 0', () => {
      assert.equal(readZ.body.kind, 'Z');
      assert.equal(readZ.body.sales.count, 0);
      assert.equal(readZ.body.sales.canceledCount, 2);
      assert.equal(Number(readZ.body.cash.difference), 0);
      assert.equal(Number(readZ.body.cash.counted), 100);
    });
  } finally {
    // Limpeza best-effort: inativa os produtos de teste.
    if (token) {
      if (productId) {
        await api('DELETE', `/products/${productId}`).catch(() => undefined);
      }
      if (product2Id) {
        await api('DELETE', `/products/${product2Id}`).catch(() => undefined);
      }
    }
    await app.close();
  }

  console.log(`\n${passed} verificacoes OK — fluxo de caixa integro.`);
}

main().catch((err) => {
  console.error('\nE2E FALHOU:', err instanceof Error ? err.message : err);
  process.exit(1);
});
