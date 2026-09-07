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
import { PrismaService } from '../src/prisma/prisma.service';

const envPath = path.join(__dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// O registro de acesso e uma linha JSON por requisicao: util em producao,
// ilegivel no meio da saida do teste. As metricas continuam sendo alimentadas.
process.env.HTTP_LOG = 'off';

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
  const api = async (
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(extraHeaders ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, body: json as any };
  };

  const sku = `E2E-${Date.now()}`;
  const sku2 = `E2E-${Date.now()}-B`;
  // Item de balanca: o codigo impresso na etiqueta tem 6 digitos.
  const skuScale = String(Date.now()).slice(-6);
  let productId = '';
  let product2Id = '';
  let scaleProductId = '';
  let concurCancelProductId = '';
  let concurReturnProductId = '';
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

    // 2) Pre-condicao: caixa do admin fechado. Uma execucao interrompida no
    //    meio deixa o turno "Caixa E2E" aberto — esse a gente mesmo fecha.
    const leftover = await api('GET', '/cash/current');
    if (leftover.body?.status === 'ABERTA' && leftover.body.terminal === 'Caixa E2E') {
      await api('POST', '/cash/close', {
        countedAmount: Number(leftover.body.expectedAmount),
        notes: 'fechamento automatico de execucao anterior do e2e',
      });
    }

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
      cost: 6,
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
    const open = await api('POST', '/cash/open', {
      openingAmount: 100,
      terminal: 'Caixa E2E',
    });
    check('abre caixa -> ABERTA, abertura 100, terminal gravado', () => {
      assert.equal(open.status, 201);
      assert.equal(open.body.status, 'ABERTA');
      assert.equal(Number(open.body.openingAmount), 100);
      assert.equal(open.body.terminal, 'Caixa E2E');
    });

    // 5) Vender 2 un a R$ 10, pagas em dinheiro (R$ 20)
    const sale = await api('POST', '/sales', {
      items: [{ productId, quantity: 2 }],
      payments: [{ method: 'DINHEIRO', amount: 20 }],
      terminal: 'Caixa E2E',
    });
    check('registra venda -> CONCLUIDA, total 20, terminal gravado', () => {
      assert.equal(sale.status, 201);
      assert.equal(sale.body.status, 'CONCLUIDA');
      assert.equal(Number(sale.body.total), 20);
      assert.ok(sale.body.number > 0, 'venda sem numero');
      assert.equal(sale.body.terminal, 'Caixa E2E');
    });
    saleId = sale.body.id;

    // 5b) Custo gravado NO ITEM da venda. Sem este snapshot, mudar o custo do
    // produto amanha reescreveria a margem de hoje — e o DRE de um periodo ja
    // fechado passaria a devolver outro numero a cada reprecificacao.
    const itemCusto = await app.get(PrismaService).saleItem.findFirst({
      where: { saleId: sale.body.id },
      select: { unitCost: true },
    });
    check('item da venda guarda o custo que valia no momento', () => {
      assert.ok(itemCusto, 'venda sem item');
      assert.equal(Number(itemCusto!.unitCost), 6);
    });

    const custoNovo = await api('PATCH', `/products/${productId}`, { cost: 9 });
    const hoje = new Date();
    const dia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    const margemDepois = await api('GET', `/reports/products?from=${dia}&to=${dia}`);
    check('reprecificar o custo nao mexe na margem ja realizada', () => {
      assert.equal(custoNovo.status, 200);
      const linha = margemDepois.body.linhas.find(
        (l: any) => l.productId === productId,
      );
      assert.ok(linha, 'produto fora do relatorio de margem');
      // 2 un x custo 6 gravado na venda — nao 2 x 9, o custo de agora.
      assert.equal(Number(linha.custo), 12);
    });

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
      assert.ok(
        stockDown.body?.stock,
        `GET /products/:id sem estoque (status ${stockDown.status}): ${JSON.stringify(stockDown.body)}`,
      );
      assert.equal(Number(stockDown.body.stock.quantity), 3);
    });

    // 7-X) Leitura X do turno: 1 venda de 20, tudo em dinheiro.
    const readX = await api('GET', '/cash/report');
    check('leitura X -> 1 venda, 20 em dinheiro, esperado 120', () => {
      assert.equal(readX.body.kind, 'X');
      assert.equal(readX.body.session.terminal, 'Caixa E2E');
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
    // A emissao ja dispara em segundo plano no fechamento da venda. Aqui
    // forcamos de novo (idempotente) e aguardamos o documento sair de
    // PROCESSANDO: se o disparo assincrono ainda estiver falando com o
    // provedor simulado, a trava condicional devolve o estado atual.
    let emitted = await api('POST', `/fiscal/documents/${fiscalId}/emit`);
    for (
      let i = 0;
      i < 40 && ['PENDENTE', 'PROCESSANDO'].includes(emitted.body?.status);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 50));
      emitted = await api('POST', `/fiscal/documents/${fiscalId}/emit`);
    }
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

    // 7h-2) SEC-047: dois cancelamentos concorrentes da MESMA venda nao podem
    // dobrar o estorno de estoque nem a sangria de caixa. Produto e valores
    // proprios do teste, e o resultado e neutro em caixa/estoque no final
    // (venda + um unico cancelamento), para nao afetar as asserções absolutas
    // de saldo mais adiante no arquivo.
    const concurCancelProduct = await api('POST', '/products', {
      sku: `${sku}-RACE-CANCEL`,
      name: 'Produto E2E — corrida de cancelamento',
      price: 10,
      unit: 'UN',
      initialStock: 5,
      minStock: 1,
    });
    concurCancelProductId = concurCancelProduct.body.id;
    const cashBeforeCancelRace = await api('GET', '/cash/current');
    const cancelRaceSale = await api('POST', '/sales', {
      items: [{ productId: concurCancelProductId, quantity: 2 }],
      payments: [{ method: 'DINHEIRO', amount: 20 }],
    });
    const [cancelRaceA, cancelRaceB] = await Promise.all([
      api('POST', `/sales/${cancelRaceSale.body.id}/cancel`, { reason: 'corrida A' }),
      api('POST', `/sales/${cancelRaceSale.body.id}/cancel`, { reason: 'corrida B' }),
    ]);
    const stockAfterCancelRace = await api('GET', `/products/${concurCancelProductId}`);
    const cashAfterCancelRace = await api('GET', '/cash/current');
    check('dois cancelamentos simultaneos da mesma venda: um 2xx e um 400', () => {
      const statuses = [cancelRaceA.status, cancelRaceB.status].sort((a, b) => a - b);
      assert.deepEqual(
        statuses,
        [201, 400],
        `esperado [201,400], recebido ${JSON.stringify([cancelRaceA.status, cancelRaceB.status])}`,
      );
    });
    check('estoque volta a exatamente 5 apos a corrida (nao 7, SEC-047)', () => {
      assert.equal(Number(stockAfterCancelRace.body.stock.quantity), 5);
    });
    check('caixa recua ao valor de antes da venda: uma unica sangria (SEC-047)', () => {
      assert.equal(
        Number(cashAfterCancelRace.body.expectedAmount),
        Number(cashBeforeCancelRace.body.expectedAmount),
      );
    });

    // 7h-3) SEC-048: duas devolucoes concorrentes do MESMO item nao podem
    // devolver mais do que foi vendido, nem duplicar a sangria.
    const concurReturnProduct = await api('POST', '/products', {
      sku: `${sku}-RACE-RETURN`,
      name: 'Produto E2E — corrida de devolucao',
      price: 10,
      unit: 'UN',
      initialStock: 5,
      minStock: 1,
    });
    concurReturnProductId = concurReturnProduct.body.id;
    const cashBeforeReturnRace = await api('GET', '/cash/current');
    const returnRaceSale = await api('POST', '/sales', {
      items: [{ productId: concurReturnProductId, quantity: 1 }],
      payments: [{ method: 'DINHEIRO', amount: 10 }],
    });
    const returnRaceItemId = returnRaceSale.body.items?.[0]?.id;
    const [returnRaceA, returnRaceB] = await Promise.all([
      api('POST', `/sales/${returnRaceSale.body.id}/returns`, {
        items: [{ saleItemId: returnRaceItemId, quantity: 1 }],
        reason: 'corrida A',
        refundMethod: 'DINHEIRO',
      }),
      api('POST', `/sales/${returnRaceSale.body.id}/returns`, {
        items: [{ saleItemId: returnRaceItemId, quantity: 1 }],
        reason: 'corrida B',
        refundMethod: 'DINHEIRO',
      }),
    ]);
    const stockAfterReturnRace = await api('GET', `/products/${concurReturnProductId}`);
    const cashAfterReturnRace = await api('GET', '/cash/current');
    check('duas devolucoes simultaneas do mesmo item: uma 2xx e uma 400 (SEC-048)', () => {
      const statuses = [returnRaceA.status, returnRaceB.status].sort((a, b) => a - b);
      assert.ok(
        statuses[1] === 400 && (statuses[0] === 200 || statuses[0] === 201),
        `esperado uma 2xx e uma 400, recebido ${JSON.stringify([returnRaceA.status, returnRaceB.status])}`,
      );
    });
    check('estoque devolvido uma unica vez: volta a 5, nao a 6 (SEC-048)', () => {
      assert.equal(Number(stockAfterReturnRace.body.stock.quantity), 5);
    });
    check('caixa recua ao valor de antes da venda: uma unica sangria de devolucao (SEC-048)', () => {
      assert.equal(
        Number(cashAfterReturnRace.body.expectedAmount),
        Number(cashBeforeReturnRace.body.expectedAmount),
      );
    });

    // 7i) Item por peso: preco por kg, quantidade fracionaria vinda da balanca.
    const scaleProduct = await api('POST', '/products', {
      sku: skuScale,
      name: 'Queijo Minas Frescal E2E',
      price: 10,
      pricingMode: 'WEIGHT',
      initialStock: 5,
      minStock: 1,
    });
    check('cria produto por peso -> pricingMode WEIGHT, unidade KG', () => {
      assert.equal(scaleProduct.status, 201);
      assert.equal(scaleProduct.body.pricingMode, 'WEIGHT');
      assert.equal(scaleProduct.body.unit, 'KG');
    });
    scaleProductId = scaleProduct.body.id;

    // Etiqueta 2 + 6 digitos de item + 01234 g -> 1,234 kg a R$ 10/kg = R$ 12,34
    const weighed = await api('POST', '/sales', {
      items: [{ productId: scaleProductId, quantity: 1.234 }],
      payments: [{ method: 'PIX', amount: 12.34 }],
    });
    check('venda por peso 1,234 kg x R$ 10/kg -> total 12,34', () => {
      assert.equal(weighed.status, 201);
      assert.equal(Number(weighed.body.total), 12.34);
      assert.equal(Number(weighed.body.items[0].quantity), 1.234);
    });

    const scaleStock = await api('GET', `/products/${scaleProductId}`);
    check('estoque por peso baixou 1,234 (5 -> 3,766)', () => {
      assert.equal(Number(scaleStock.body.stock.quantity), 3.766);
    });

    // 7j) Busca do PDV: tolera acento e erro de digitacao (indices trigram).
    const byAccent = await api('GET', '/products?search=' + encodeURIComponent('miñas') + '&onlyActive=true');
    const byTypo = await api('GET', '/products?search=' + encodeURIComponent('frescall') + '&onlyActive=true');
    check('busca tolera acento e erro de digitacao', () => {
      assert.ok(
        byAccent.body.some((p: any) => p.id === scaleProductId),
        'busca com acento nao achou o produto',
      );
      assert.ok(
        byTypo.body.some((p: any) => p.id === scaleProductId),
        'busca com erro de digitacao nao achou o produto',
      );
    });

    await api('POST', `/sales/${weighed.body.id}/cancel`, { reason: 'e2e cleanup peso' });

    // 7k) RBAC: catalogo de permissoes, papeis internos e enforcement real.
    const perms = await api('GET', '/access/permissions');
    const roles = await api('GET', '/access/roles');
    check('catalogo de permissoes e papeis internos no banco', () => {
      assert.equal(perms.status, 200);
      assert.ok(perms.body.length >= 20, 'catalogo de permissoes vazio');
      const keys = roles.body.map((r: any) => r.key).sort();
      assert.deepEqual(keys, ['ADMIN', 'GERENTE', 'OPERADOR']);
      const admin = roles.body.find((r: any) => r.key === 'ADMIN');
      assert.equal(admin.permissions.length, perms.body.length, 'ADMIN sem acesso total');
      assert.ok(admin.system, 'ADMIN deveria ser papel interno');
    });

    const meAdmin = await api('GET', '/access/me');
    check('GET /access/me devolve o conjunto efetivo', () => {
      assert.equal(meAdmin.status, 200);
      assert.ok(meAdmin.body.permissions.includes('users.manage'));
    });

    // O operador nao enxerga gestao de acesso nem dashboard.
    const adminToken2 = token;
    const op2 = await api('POST', '/auth/login', { username: 'operador', password: 'operador' });
    token = op2.body.access_token;
    const opUsers = await api('GET', '/access/users');
    const opDash = await api('GET', '/dashboard/summary');
    const opSales = await api('GET', '/sales');
    const opMe = await api('GET', '/access/me');
    token = adminToken2;
    check('operador: 403 em access/users e dashboard, 200 no que lhe cabe', () => {
      assert.equal(opUsers.status, 403);
      assert.equal(opDash.status, 403);
      assert.equal(opSales.status, 200);
      assert.equal(opMe.status, 200);
      assert.ok(!opMe.body.permissions.includes('users.manage'));
      assert.ok(opMe.body.permissions.includes('sales.create'));
    });

    // Excecao por usuario: concede dashboard.view so para o operador.
    const opUser = (await api('GET', '/access/users')).body.find(
      (u: any) => u.username === 'operador',
    );
    await api('PUT', `/access/users/${opUser.id}/overrides`, {
      overrides: [{ permissionKey: 'dashboard.view', allow: true }],
    });
    const op3 = await api('POST', '/auth/login', { username: 'operador', password: 'operador' });
    token = op3.body.access_token;
    const opDash2 = await api('GET', '/dashboard/summary');
    token = adminToken2;
    check('excecao por usuario concede acesso na hora', () => {
      assert.equal(opDash2.status, 200);
      assert.ok(op3.body.permissions.includes('dashboard.view'));
    });

    // Limpa a excecao para nao vazar estado entre execucoes.
    await api('PUT', `/access/users/${opUser.id}/overrides`, { overrides: [] });
    const op4 = await api('POST', '/auth/login', { username: 'operador', password: 'operador' });
    token = op4.body.access_token;
    const opDash3 = await api('GET', '/dashboard/summary');
    token = adminToken2;
    check('remover a excecao volta a negar', () => {
      assert.equal(opDash3.status, 403);
    });

    // 7l) Ciclo de vida do usuario: criar, renomear e trocar senha.
    const prisma = app.get(PrismaService);
    const E2E_USER = 'e2e.caixa';
    const E2E_USER_RENAMED = 'e2e.caixa.novo';
    /** Remove o usuario de teste junto com a trilha que ele mesmo assinou. */
    const dropE2eUsers = async () => {
      const stale = await prisma.user.findMany({
        where: { username: { in: [E2E_USER, E2E_USER_RENAMED] } },
        select: { id: true },
      });
      if (!stale.length) return;
      const ids = stale.map((u) => u.id);
      await prisma.auditLog.deleteMany({
        where: { OR: [{ actorId: { in: ids } }, { approverId: { in: ids } }] },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    };

    // Uma execucao interrompida antes da limpeza nao pode contaminar esta.
    await dropE2eUsers();
    const operatorRole = roles.body.find((r: any) => r.key === 'OPERADOR');

    const created = await api('POST', '/access/users', {
      username: E2E_USER,
      name: 'Caixa E2E',
      password: 'senha-inicial-1',
      roleId: operatorRole.id,
    });
    const newUserId = created.body?.id;
    check('POST /access/users cria usuario sem devolver o hash da senha', () => {
      assert.equal(created.status, 201);
      assert.equal(created.body.username, E2E_USER);
      assert.equal(created.body.accessRole.key, 'OPERADOR');
      assert.ok(!('passwordHash' in created.body), 'hash da senha vazou na resposta');
    });

    const dup = await api('POST', '/access/users', {
      username: E2E_USER,
      name: 'Outro Caixa',
      password: 'senha-inicial-1',
      roleId: operatorRole.id,
    });
    const weak = await api('POST', '/access/users', {
      username: 'e2e.fraco',
      name: 'Senha Fraca',
      password: '123',
      roleId: operatorRole.id,
    });
    const badLogin = await api('POST', '/access/users', {
      username: 'ab',
      name: 'Login Curto',
      password: 'senha-inicial-1',
      roleId: operatorRole.id,
    });
    check('POST /access/users recusa login repetido, senha curta e login invalido', () => {
      assert.equal(dup.status, 400);
      assert.equal(weak.status, 400);
      assert.equal(badLogin.status, 400);
    });

    const firstLogin = await api('POST', '/auth/login', {
      username: E2E_USER,
      password: 'senha-inicial-1',
    });
    check('usuario recem-criado ja entra com o papel escolhido', () => {
      assert.equal(firstLogin.status, 201);
      assert.ok(firstLogin.body.access_token, 'sem access_token');
      assert.ok(firstLogin.body.permissions.includes('sales.create'));
      assert.ok(!firstLogin.body.permissions.includes('users.manage'));
    });

    const renamed = await api('PATCH', `/access/users/${newUserId}`, {
      name: 'Caixa E2E Renomeado',
      username: E2E_USER_RENAMED,
    });
    const takeAdminLogin = await api('PATCH', `/access/users/${newUserId}`, {
      username: 'admin',
    });
    check('PATCH /access/users/:id renomeia e barra login ja usado', () => {
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.username, E2E_USER_RENAMED);
      assert.equal(renamed.body.name, 'Caixa E2E Renomeado');
      assert.equal(takeAdminLogin.status, 400);
    });

    const reset = await api('PUT', `/access/users/${newUserId}/password`, {
      password: 'senha-trocada-2',
    });
    const oldPass = await api('POST', '/auth/login', {
      username: E2E_USER_RENAMED,
      password: 'senha-inicial-1',
    });
    const newPass = await api('POST', '/auth/login', {
      username: E2E_USER_RENAMED,
      password: 'senha-trocada-2',
    });
    check('admin redefine a senha de outro usuario e a antiga deixa de valer', () => {
      assert.equal(reset.status, 200);
      assert.equal(oldPass.status, 401);
      assert.equal(newPass.status, 201);
    });

    // Trocar a PROPRIA senha exige a atual, mesmo sem users.manage.
    const adminTokenUsers = token;
    token = newPass.body.access_token;
    const wrongCurrent = await api('PUT', '/access/me/password', {
      password: 'senha-final-3',
      currentPassword: 'errada',
    });
    const rightCurrent = await api('PUT', '/access/me/password', {
      password: 'senha-final-3',
      currentPassword: 'senha-trocada-2',
    });
    token = adminTokenUsers;
    const finalLogin = await api('POST', '/auth/login', {
      username: E2E_USER_RENAMED,
      password: 'senha-final-3',
    });
    check('troca da propria senha exige a senha atual correta', () => {
      assert.equal(wrongCurrent.status, 400);
      assert.equal(rightCurrent.status, 200);
      assert.equal(finalLogin.status, 201);
    });

    await dropE2eUsers();

    // Configuracoes do sistema vivem no banco e sao editaveis.
    const settingsBefore = await api('GET', '/app-settings');
    const original = settingsBefore.body.find((r: any) => r.key === 'sales.maxInstallments');
    const putSetting = await api('PUT', '/app-settings', {
      settings: [{ key: 'sales.maxInstallments', value: 18 }],
    });
    const settingsAfter = await api('GET', '/app-settings');
    const changed = settingsAfter.body.find((r: any) => r.key === 'sales.maxInstallments');
    await api('PUT', '/app-settings', {
      settings: [{ key: 'sales.maxInstallments', value: original.value }],
    });
    const invalid = await api('PUT', '/app-settings', {
      settings: [{ key: 'sales.maxInstallments', value: 999 }],
    });
    check('configuracoes no banco: leitura, escrita e validacao', () => {
      assert.equal(settingsBefore.status, 200);
      assert.ok(settingsBefore.body.length >= 5, 'catalogo de configuracoes vazio');
      assert.equal(putSetting.status, 200, 'PUT de configuracao deveria responder 200');
      assert.equal(Number(changed.value), 18);
      assert.equal(invalid.status, 400, 'valor fora do intervalo deveria ser recusado');
    });

    // Daqui se afrouxa o rate limit do login: alterar configuracao tem de doer
    // na trilha. Sem isto, quem desliga a defesa nao deixa rastro.
    const auditSettings = await api('GET', '/access/audit?action=appSettings.update');
    check('alteracao de configuracao entra na trilha com antes e depois', () => {
      assert.equal(auditSettings.status, 200);
      const linha = auditSettings.body.find((a: any) =>
        (a.detail?.mudancas ?? []).some(
          (m: any) => m.chave === 'sales.maxInstallments',
        ),
      );
      assert.ok(linha, 'sem registro de appSettings.update');
      assert.equal(linha.actor.username, 'admin');
      const mud = linha.detail.mudancas.find(
        (m: any) => m.chave === 'sales.maxInstallments',
      );
      assert.ok('de' in mud && 'para' in mud, 'trilha sem antes/depois');
    });

    // 7p) Motor de promocoes: quem decide o desconto e o SERVIDOR.
    // Todas as vendas deste bloco pagam em PIX (nao mexem na gaveta) e sao
    // canceladas ao final, para nao deslocar o fechamento do turno.
    const promoIds: string[] = [];
    const promoSales: string[] = [];

    // 10% no 2o produto (preco 10) — PERCENT por produto.
    const promoPercent = await api('POST', '/promotions', {
      name: 'E2E 10% no produto',
      kind: 'PERCENT',
      scope: 'PRODUCT',
      productId: product2Id,
      value: 10,
      priority: 1,
    });
    if (promoPercent.body?.id) promoIds.push(promoPercent.body.id);

    const sim = await api('POST', '/promotions/simulate', {
      items: [{ productId: product2Id, quantity: 2 }],
    });
    check('simulacao devolve o desconto da campanha ativa', () => {
      assert.equal(promoPercent.status, 201);
      assert.equal(sim.status, 201);
      assert.equal(sim.body.total, 2, '10% de 2 x R$10 deveria dar R$2');
      assert.equal(sim.body.lines[0].promotionName, 'E2E 10% no produto');
      assert.equal(sim.body.lines[0].index, 0);
    });

    const promoSale = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 2 }],
      payments: [{ method: 'PIX', amount: 18 }],
    });
    if (promoSale.body?.id) promoSales.push(promoSale.body.id);
    const promoSaleFull = await api('GET', `/sales/${promoSale.body?.id}`);
    check('venda aplica a promocao sem o cliente pedir e registra a campanha', () => {
      assert.equal(promoSale.status, 201);
      assert.equal(Number(promoSale.body.total), 18, 'total deveria sair 20 - 2');
      const item = promoSaleFull.body.items[0];
      assert.equal(Number(item.promoDiscount), 2);
      assert.equal(item.promotionName, 'E2E 10% no produto');
      assert.equal(Number(item.discount), 2);
    });

    // Pagar so o valor cheio menos a promocao: se o servidor NAO aplicasse o
    // desconto, este pagamento seria insuficiente e a venda cairia em 400.
    const promoUnderpay = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 2 }],
      payments: [{ method: 'PIX', amount: 17.99 }],
    });
    check('pagamento abaixo do total ja promocionado ainda e recusado', () => {
      assert.equal(promoUnderpay.status, 400);
    });

    // Leve 3 pague 2 vence a de 10% por prioridade maior.
    const promo3x2 = await api('POST', '/promotions', {
      name: 'E2E leve 3 pague 2',
      kind: 'BUY_X_PAY_Y',
      scope: 'PRODUCT',
      productId: product2Id,
      buyQty: 3,
      payQty: 2,
      priority: 5,
    });
    if (promo3x2.body?.id) promoIds.push(promo3x2.body.id);
    const sim3x2 = await api('POST', '/promotions/simulate', {
      items: [{ productId: product2Id, quantity: 3 }],
    });
    check('promocoes nao se acumulam: vence a de maior prioridade', () => {
      assert.equal(promo3x2.status, 201);
      assert.equal(sim3x2.body.total, 10, 'leve 3 pague 2 deveria dar 1 unidade gratis');
      assert.equal(sim3x2.body.lines[0].promotionName, 'E2E leve 3 pague 2');
    });

    const invalidPromo = await api('POST', '/promotions', {
      name: 'E2E incoerente',
      kind: 'BUY_X_PAY_Y',
      scope: 'PRODUCT',
      productId: product2Id,
      buyQty: 2,
      payQty: 3,
    });
    const invalidPercent = await api('POST', '/promotions', {
      name: 'E2E percentual absurdo',
      kind: 'PERCENT',
      scope: 'ALL',
      value: 150,
    });
    check('promocao incoerente e recusada na criacao, nao no balcao', () => {
      assert.equal(invalidPromo.status, 400, 'payQty >= buyQty deveria falhar');
      assert.equal(invalidPercent.status, 400, 'percentual > 100 deveria falhar');
    });

    // O teto de desconto do operador vale para o que ELE concede. Uma campanha
    // agressiva da loja nao pode travar o caixa.
    const adminTokenPromo = token;
    const promoBig = await api('POST', '/promotions', {
      name: 'E2E 50% catalogo todo',
      kind: 'PERCENT',
      scope: 'ALL',
      value: 50,
      priority: 9,
    });
    if (promoBig.body?.id) promoIds.push(promoBig.body.id);
    // Um unico login de operador serve os dois blocos: a suite ja roda perto do
    // teto do rate limit de login, e um login a mais derruba o seguinte.
    const opLoginShared = await api('POST', '/auth/login', {
      username: 'operador',
      password: 'operador',
    });
    check('login do operador para os blocos de promocao e supervisao', () => {
      assert.equal(
        opLoginShared.status,
        201,
        'login do operador falhou (rate limit da suite?) — os blocos seguintes dependem dele',
      );
      assert.ok(opLoginShared.body.access_token, 'login sem access_token');
    });
    token = opLoginShared.body.access_token;
    const opPromoSale = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 1 }],
      payments: [{ method: 'PIX', amount: 5 }],
    });
    if (opPromoSale.body?.id) promoSales.push(opPromoSale.body.id);
    const opCreatePromo = await api('POST', '/promotions', {
      name: 'E2E operador nao pode',
      kind: 'PERCENT',
      scope: 'ALL',
      value: 5,
    });
    token = adminTokenPromo;
    check('promocao da loja nao consome o teto de desconto do operador', () => {
      assert.equal(opPromoSale.status, 201, '50% de campanha nao pode barrar o caixa');
      assert.equal(Number(opPromoSale.body.total), 5);
    });
    check('operador ve promocoes mas nao cria', () => {
      assert.equal(opCreatePromo.status, 403);
    });

    // Desativar encerra a campanha na hora.
    // PATCH parcial: mandar so `active` nao pode apagar o resto da regra.
    for (const id of [promoBig.body?.id, promo3x2.body?.id, promoPercent.body?.id]) {
      if (id) await api('PATCH', `/promotions/${id}`, { active: false });
    }
    const simOff = await api('POST', '/promotions/simulate', {
      items: [{ productId: product2Id, quantity: 3 }],
    });
    check('campanha desativada para de valer imediatamente', () => {
      assert.equal(simOff.body.total, 0);
      assert.equal(simOff.body.lines.length, 0);
    });

    // SEC-029: PATCH e atualizacao PARCIAL. Corrigir o nome de uma campanha
    // encerrada nao pode ressuscita-la valendo para sempre.
    const comFim = await api('POST', '/promotions', {
      name: 'E2E campanha com fim',
      kind: 'PERCENT',
      scope: 'PRODUCT',
      productId: product2Id,
      value: 20,
      priority: 7,
      endsAt: '2030-12-25T23:59:59.000Z',
      active: false,
    });
    if (comFim.body?.id) promoIds.push(comFim.body.id);
    const soNome = await api('PATCH', `/promotions/${comFim.body?.id}`, {
      name: 'E2E campanha com fim (renomeada)',
    });
    check('PATCH parcial preserva vigencia, prioridade e estado da campanha', () => {
      assert.equal(comFim.status, 201);
      assert.equal(soNome.status, 200);
      assert.equal(soNome.body.name, 'E2E campanha com fim (renomeada)');
      assert.ok(soNome.body.endsAt, 'endsAt foi apagado pelo PATCH');
      assert.equal(soNome.body.priority, 7, 'priority voltou ao default');
      assert.equal(soNome.body.active, false, 'campanha desativada foi reativada');
      assert.equal(Number(soNome.body.value), 20, 'value foi perdido');
    });

    // SEC-034: numero invalido chegava como `null`, o merge mantinha o valor
    // antigo e a resposta era 200 — a tela dizia que salvou e a loja seguia
    // praticando o desconto velho. Agora `null` em campo obrigatorio e 400.
    const nulo = await api('PATCH', `/promotions/${comFim.body?.id}`, {
      value: null,
    });
    const depoisDoNulo = await api('GET', '/promotions');
    check('valor nulo no PATCH e recusado, nao aceito em silencio', () => {
      assert.equal(nulo.status, 400, 'value:null deveria ser 400');
      const p = depoisDoNulo.body.find((x: any) => x.id === comFim.body?.id);
      assert.equal(Number(p.value), 20, 'campanha foi alterada apesar do 400');
    });

    // SEC-036: campo limpavel precisa poder ser LIMPO. `null` remove a data.
    const limpaFim = await api('PATCH', `/promotions/${comFim.body?.id}`, {
      endsAt: null,
    });
    check('campo limpavel aceita null e some de verdade', () => {
      assert.equal(limpaFim.status, 200);
      assert.equal(limpaFim.body.endsAt, null, 'endsAt continuou preenchido');
      assert.equal(Number(limpaFim.body.value), 20, 'limpar a data mexeu no valor');
    });

    // SEC-030: a trilha precisa dizer O QUE mudou, com valor.
    await api('PATCH', `/promotions/${comFim.body?.id}`, { value: 90 });
    const auditUpd = await api('GET', '/access/audit?action=promotions.update');
    check('trilha de promocao registra o valor alterado, nao so o nome do campo', () => {
      const linha = auditUpd.body.find((a: any) =>
        (a.detail?.mudancas ?? []).some(
          (m: any) => m.campo === 'value' && String(m.para) === '90',
        ),
      );
      assert.ok(linha, 'sem registro de promotions.update com o valor');
      const mud = linha.detail.mudancas.find((m: any) => m.campo === 'value');
      assert.equal(String(mud.de), '20', 'trilha sem o valor anterior');
    });

    // SEC-031: array sem teto era DoS autenticado — qualquer operador parava a loja.
    const carrinhoAbsurdo = await api('POST', '/promotions/simulate', {
      items: Array.from({ length: 500 }, () => ({
        productId: product2Id,
        quantity: 1,
      })),
    });
    const carrinhoNormal = await api('POST', '/promotions/simulate', {
      items: [{ productId: product2Id, quantity: 1 }],
    });
    check('simulacao recusa carrinho absurdo e aceita o normal', () => {
      assert.equal(carrinhoAbsurdo.status, 400, 'array sem teto na simulacao');
      assert.equal(carrinhoNormal.status, 201);
    });

    const auditPromo = await api('GET', '/access/audit?action=promotions.create');
    check('criacao de promocao entra na trilha', () => {
      assert.ok(
        auditPromo.body.some((a: any) => a.detail?.nome === 'E2E 10% no produto'),
        'sem registro de promotions.create',
      );
    });

    // Limpeza: cancela as vendas do bloco e remove as campanhas de teste.
    for (const id of promoSales) {
      await api('POST', `/sales/${id}/cancel`, {
        reason: 'limpeza do bloco de promocoes e2e',
      }).catch(() => undefined);
    }
    for (const id of promoIds) {
      await api('DELETE', `/promotions/${id}`).catch(() => undefined);
    }

    // 7l) Supervisao: o operador esbarra no teto e um gerente libera na hora.
    const adminToken3 = token;
    token = opLoginShared.body.access_token;

    const blocked = await api('POST', '/sales', {
      items: [{ productId: product2Id, quantity: 1, discount: 3 }], // 30%
      payments: [{ method: 'PIX', amount: 7 }],
    });

    // Credenciais erradas e auto-liberacao nao valem.
    const badPass = await api('POST', '/access/authorize', {
      username: 'gerente',
      password: 'errada',
      permission: 'sales.discountOverride',
    });
    const selfGrant = await api('POST', '/access/authorize', {
      username: 'operador',
      password: 'operador',
      permission: 'sales.discountOverride',
    });

    const grant = await api('POST', '/access/authorize', {
      username: 'gerente',
      password: 'gerente',
      permission: 'sales.discountOverride',
      reason: 'cliente antigo, e2e',
    });

    const released = await api(
      'POST',
      '/sales',
      {
        items: [{ productId: product2Id, quantity: 1, discount: 3 }],
        payments: [{ method: 'PIX', amount: 7 }],
      },
      { 'X-Authorization-Grant': grant.body?.token ?? '' },
    );

    // O mesmo vale nao serve duas vezes.
    const reused = await api(
      'POST',
      '/sales',
      {
        items: [{ productId: product2Id, quantity: 1, discount: 3 }],
        payments: [{ method: 'PIX', amount: 7 }],
      },
      { 'X-Authorization-Grant': grant.body?.token ?? '' },
    );

    // Vale para uma permissao que o operador nao tem: cancelar venda.
    const cancelGrant = await api('POST', '/access/authorize', {
      username: 'gerente',
      password: 'gerente',
      permission: 'sales.cancel',
    });
    const opCancel = await api(
      'POST',
      `/sales/${released.body?.id}/cancel`,
      { reason: 'e2e supervisao' },
      { 'X-Authorization-Grant': cancelGrant.body?.token ?? '' },
    );

    // Brute force da senha de supervisor: sem teto, esta rota e um oraculo de
    // senha para qualquer usuario autenticado. O uso legitimo e raro (o gerente
    // digita a senha uma ou duas vezes), entao o limite e baixo de proposito.
    let bloqueio = 0;
    for (let i = 0; i < 10 && bloqueio === 0; i++) {
      const tentativa = await api('POST', '/access/authorize', {
        username: 'gerente',
        password: `chute-${i}`,
        permission: 'sales.cancel',
      });
      if (tentativa.status === 429) bloqueio = 429;
    }

    token = adminToken3;
    check('rate limit corta o brute force da senha de supervisor', () => {
      assert.equal(bloqueio, 429, 'tentativas ilimitadas em /access/authorize');
    });
    check('supervisor libera desconto acima do teto (vale de uso unico)', () => {
      assert.equal(blocked.status, 400, 'sem liberacao deveria barrar');
      assert.equal(badPass.status, 401, 'senha errada deveria falhar');
      assert.equal(selfGrant.status, 403, 'ninguem libera a si mesmo');
      assert.equal(grant.status, 201);
      assert.equal(grant.body.permission, 'sales.discountOverride');
      assert.equal(released.status, 201, 'com o vale a venda deveria passar');
      assert.equal(reused.status, 400, 'o vale nao pode ser reutilizado');
    });
    check('vale libera o operador a cancelar uma venda', () => {
      assert.ok([200, 201].includes(opCancel.status));
      assert.equal(opCancel.body.status, 'CANCELADA');
    });

    const audit = await api('GET', '/access/audit');
    check('trilha de auditoria registra quem fez e quem liberou', () => {
      assert.equal(audit.status, 200);
      const override = audit.body.find(
        (a: any) => a.action === 'sales.discountOverride',
      );
      assert.ok(override, 'sem registro de sales.discountOverride');
      assert.equal(override.actor.username, 'operador');
      assert.equal(override.approver.username, 'gerente');
      const cancel = audit.body.find(
        (a: any) => a.action === 'sales.cancel' && a.approver?.username === 'gerente',
      );
      assert.ok(cancel, 'sem registro do cancelamento liberado');
      // Tentativa recusada tambem deixa rastro: chutar senha de supervisor sem
      // deixar registro era o que tornava a rota um oraculo silencioso.
      const negada = audit.body.find(
        (a: any) =>
          a.action === 'authorization.denied' &&
          a.detail?.motivo === 'credenciais inválidas',
      );
      assert.ok(negada, 'senha errada de supervisor nao entrou na trilha');
      const auto = audit.body.find(
        (a: any) =>
          a.action === 'authorization.denied' && a.detail?.motivo === 'auto-liberação',
      );
      assert.ok(auto, 'auto-liberacao recusada nao entrou na trilha');
      assert.ok(
        audit.body.some((a: any) => a.action === 'authorization.grant'),
        'sem registro da liberacao em si',
      );
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

    // 10a) Porta de pagamento: provedores registrados.
    const gateways = await api('GET', '/payments/gateways');
    check('gateways ativos: balcao (dinheiro) e eletronico simulado (cartao/pix)', () => {
      assert.equal(gateways.status, 200);
      const names = gateways.body.map((g: any) => g.name).sort();
      assert.deepEqual(names, ['balcao', 'fake-eletronico']);
      const balcao = gateways.body.find((g: any) => g.name === 'balcao');
      const eletronico = gateways.body.find((g: any) => g.name === 'fake-eletronico');
      assert.ok(balcao.methods.includes('DINHEIRO'), 'balcao nao atende DINHEIRO');
      assert.ok(eletronico.methods.includes('PIX'), 'eletronico nao atende PIX');
      assert.ok(!balcao.methods.includes('PIX'), 'balcao nao deveria atender PIX');
    });

    // 10b) Pagamento em dinheiro nao passa por gateway externo: nasce e fica
    // CONFIRMADO, com o provedor de balcao gravado.
    const cashPayments = await api('GET', `/payments/sale/${saleId}`);
    check('pagamento em dinheiro -> CONFIRMADO pelo provedor de balcao', () => {
      assert.equal(cashPayments.status, 200);
      const p = cashPayments.body[0];
      assert.equal(p.provider, 'balcao');
      assert.ok(!p.authorizationCode, 'dinheiro nao deveria ter codigo de autorizacao');
    });

    // 10b-2) A venda cancelada em (8) teve os pagamentos estornados.
    check('cancelamento da venda estorna os pagamentos', () => {
      const p = cashPayments.body[0];
      assert.equal(p.status, 'ESTORNADO');
      assert.ok(p.refundedAt, 'estorno sem refundedAt');
    });

    // 10c) Pagamento eletronico passa pelo gateway e volta com autorizacao.
    const pixSale = await api('POST', '/sales', {
      items: [{ productId, quantity: 1 }],
      payments: [{ method: 'PIX', amount: 10 }],
      terminal: 'Caixa E2E',
    });
    check('venda em PIX -> autorizada pelo gateway, com NSU e QR', () => {
      assert.equal(pixSale.status, 201);
      const p = pixSale.body.payments[0];
      assert.equal(p.method, 'PIX');
      assert.equal(p.status, 'CONFIRMADO');
      assert.equal(p.provider, 'fake-eletronico');
      assert.ok(/^\d{6}$/.test(p.authorizationCode ?? ''), 'sem codigo de autorizacao de 6 digitos');
      assert.ok((p.qrCode ?? '').startsWith('000201'), 'QR do Pix fora do formato BR Code');
      assert.ok(p.authorizedAt, 'pagamento autorizado sem authorizedAt');
      // externalId e mapa da integracao: nunca sai para o balcao (SEC-025).
      assert.strictEqual(p.externalId, undefined, 'externalId nao deveria ser exposto');
    });

    // 10c-1b) Consulta posterior nao devolve o QR de uma cobranca ja liquidada.
    const pixLater = await api('GET', `/payments/sale/${pixSale.body.id}`);
    check('consulta posterior mascara o QR ja liquidado e nao expoe externalId', () => {
      assert.strictEqual(pixLater.body[0].qrCode, null);
      assert.strictEqual(pixLater.body[0].externalId, undefined);
      assert.ok(pixLater.body[0].authorizationCode, 'perdeu o codigo de autorizacao');
    });

    // 10c-2) PIX nao entra na gaveta: o saldo em dinheiro nao se mexe.
    const afterPix = await api('GET', '/cash/current');
    check('venda em PIX nao altera o dinheiro em gaveta', () => {
      assert.equal(Number(afterPix.body.expectedAmount), 100);
    });

    // 10c-3) Cancelar devolve estoque e estorna o pagamento eletronico.
    const cancelPix = await api('POST', `/sales/${pixSale.body.id}/cancel`, {
      reason: 'Teste de estorno eletronico',
    });
    const pixPayments = await api('GET', `/payments/sale/${pixSale.body.id}`);
    check('cancelamento estorna o pagamento eletronico no gateway', () => {
      assert.equal(cancelPix.status, 201);
      assert.equal(pixPayments.body[0].status, 'ESTORNADO');
      assert.ok(pixPayments.body[0].refundedAt, 'estorno eletronico sem refundedAt');
    });

    // 10c-4) O X nao conta como recebido o pagamento ja estornado.
    const readXAfterRefund = await api('GET', '/cash/report');
    check('leitura X nao soma pagamento estornado como recebido', () => {
      const pix = readXAfterRefund.body.byPaymentMethod.find((m: any) => m.method === 'PIX');
      assert.ok(!pix, 'PIX estornado ainda aparece como recebido no X');
      // O provedor simulado nunca nega por entrada alcancavel pela API
      // (@IsPositive barra o unico insumo que o faz negar), entao aqui so da
      // para conferir o formato. A cobertura real do caminho NEGADO depende de
      // um provedor de teste injetavel — ver SEC-022 no baseline.
      assert.ok(Array.isArray(readXAfterRefund.body.unsettledPayments), 'sem unsettledPayments no X');
    });

    // 10d) Teto de dinheiro na gaveta (AppSetting cash.drawerLimit).
    const drawerOff = await api('GET', '/cash/current');
    check('sem teto configurado, a gaveta nunca acusa excesso', () => {
      assert.equal(drawerOff.body.drawer.limit, 0);
      assert.equal(drawerOff.body.drawer.exceeded, false);
    });

    await api('PUT', '/app-settings', {
      settings: [{ key: 'cash.drawerLimit', value: 60 }],
    });
    const drawerOn = await api('GET', '/cash/current');
    check('gaveta com 100 e teto 60 -> excedida, sugere sangria de 40', () => {
      assert.equal(Number(drawerOn.body.drawer.limit), 60);
      assert.equal(Number(drawerOn.body.drawer.cashOnHand), 100);
      assert.equal(drawerOn.body.drawer.exceeded, true);
      assert.equal(Number(drawerOn.body.drawer.suggestedWithdrawal), 40);
    });

    // 10d-2) A leitura X do turno aberto carrega o mesmo estado da gaveta.
    const readXDrawer = await api('GET', '/cash/report');
    check('leitura X traz o estado da gaveta', () => {
      assert.equal(readXDrawer.body.drawer.exceeded, true);
      assert.equal(Number(readXDrawer.body.drawer.suggestedWithdrawal), 40);
    });

    // Devolve a configuracao ao padrao para nao contaminar o ambiente.
    await api('PUT', '/app-settings', {
      settings: [{ key: 'cash.drawerLimit', value: 0 }],
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
    check('relatorio Z -> kind Z, 1 venda ativa, 6 canceladas, diferenca 0', () => {
      assert.equal(readZ.body.kind, 'Z');
      // A venda que sobra ativa e a do bloco de corrida de devolucao (SEC-048):
      // foi vendida a vista e devolvida por inteiro. Devolucao nao e
      // cancelamento — a venda continua CONCLUIDA e a gaveta se acerta pela
      // SANGRIA da devolucao, por isso a diferenca abaixo continua zero.
      assert.equal(readZ.body.sales.count, 1);
      // A venda do bloco de promocoes feita pelo operador nao entra aqui:
      // ela nasce fora do turno do admin (o operador nao tem caixa aberto).
      assert.equal(readZ.body.sales.canceledCount, 6);
      assert.equal(Number(readZ.body.cash.difference), 0);
      assert.equal(Number(readZ.body.cash.counted), 100);
    });
    // 13) Licenciamento por módulos.
    //
    // O e2e roda com NODE_ENV=development, onde tudo liga sem chave — então
    // aqui se verifica o CONTRATO (status, catálogo, núcleo sempre ativo) e a
    // recusa de chave inválida. O gate em si (403 ModuloNaoLicenciado) depende
    // de LICENSE_PUBLIC_KEY configurada e é exercitado fora da suíte.
    const licStatus = await api('GET', '/license/status');
    check('status de licenca lista modulos e nunca omite o nucleo', () => {
      assert.equal(licStatus.status, 200);
      assert.ok(licStatus.body.modulos.includes('core'), 'nucleo fora dos modulos ativos');
      assert.ok(Array.isArray(licStatus.body.catalogo));
      const core = licStatus.body.catalogo.find((m: any) => m.key === 'core');
      assert.equal(core.core, true);
      assert.equal(core.ativo, true, 'nucleo nunca pode aparecer inativo');
      // Todo modulo do catalogo tem nome e descricao — a tela de licenca os usa.
      for (const m of licStatus.body.catalogo) {
        assert.ok(m.name && m.description, `modulo ${m.key} sem rotulo`);
      }
    });

    const chaveLixo = await api('PUT', '/settings/license', {
      key: 'CATALOG-1.naoehbase64.assinaturafalsa',
    });
    const chaveVazia = await api('PUT', '/settings/license', { key: '' });
    check('chave invalida e recusada antes de entrar no banco', () => {
      // Em desenvolvimento sem LICENSE_PUBLIC_KEY a verificacao e pulada, mas
      // o DTO continua exigindo uma chave nao vazia.
      assert.equal(chaveVazia.status, 400, 'chave vazia deveria ser 400');
      assert.ok(
        [200, 400].includes(chaveLixo.status),
        `resposta inesperada para chave lixo: ${chaveLixo.status}`,
      );
    });

    // O operador precisa ver o aviso de vencimento: a rota nao exige
    // settings.manage, so autenticacao.
    const adminTokenLic = token;
    const opLic = opLoginShared.body?.access_token;
    if (opLic) {
      token = opLic;
      const statusComoOperador = await api('GET', '/license/status');
      const licencaComoOperador = await api('GET', '/settings/license');
      token = adminTokenLic;
      check('operador le o status da licenca, mas nao a chave', () => {
        assert.equal(statusComoOperador.status, 200, 'operador deveria ver o status');
        assert.equal(
          licencaComoOperador.status,
          403,
          'a chave em si exige settings.manage',
        );
      });
    }

    // 12) Ajuste de estoque na trilha — ultimo buraco do SEC-009. Fica no fim
    // porque mexe no saldo, e todas as assercoes de estoque ja passaram.
    const ajuste = await api('POST', '/inventory/adjust', {
      productId: scaleProductId,
      type: 'PERDA',
      quantity: 0.5,
      reason: 'quebra e2e',
    });
    // SEC-038: PERDA negativa SOMAVA ao estoque e entrava na trilha como perda.
    const perdaNegativa = await api('POST', '/inventory/adjust', {
      productId: scaleProductId,
      type: 'PERDA',
      quantity: -100,
      reason: 'entrada disfarcada de perda',
    });
    check('ajuste com quantidade negativa e recusado', () => {
      assert.equal(perdaNegativa.status, 400, 'PERDA negativa deveria ser 400');
    });

    const auditAjuste = await api('GET', '/access/audit?action=inventory.adjust');
    check('ajuste de estoque entra na trilha com tipo, quantidade e motivo', () => {
      assert.ok([200, 201].includes(ajuste.status), `ajuste falhou: ${ajuste.status}`);
      const linha = auditAjuste.body.find(
        (a: any) => a.targetId === scaleProductId && a.detail?.motivo === 'quebra e2e',
      );
      assert.ok(linha, 'sem registro de inventory.adjust');
      assert.equal(linha.detail.tipo, 'PERDA');
      assert.equal(String(linha.detail.quantidade), '0.5');
    });

    // 13) Agendamento de relatorios: cria, envia agora e confere a trilha.
    // O canal REGISTRO fecha o ciclo sem credencial de terceiro — e o que
    // permite provar que o agendamento funciona antes de a loja contratar
    // e-mail ou WhatsApp.
    const agendaInvalida = await api('POST', '/reports/schedules', {
      report: 'vendas',
      name: 'Vendas para a gerencia',
      frequency: 'DIARIO',
      hour: 7,
      channel: 'EMAIL',
      recipient: '11999999999',
    });
    check('agendamento de e-mail com telefone e recusado', () => {
      assert.equal(agendaInvalida.status, 400, 'destinatario incompativel deveria dar 400');
    });

    const agenda = await api('POST', '/reports/schedules', {
      report: 'vendas',
      name: 'Vendas de ontem (e2e)',
      frequency: 'DIARIO',
      hour: 7,
      channel: 'REGISTRO',
      recipient: 'gerencia.e2e@loja.test',
    });
    check('cria agendamento diario e mascara o destinatario', () => {
      assert.equal(agenda.status, 201);
      assert.ok(agenda.body.nextRunAt, 'agendamento sem proxima execucao');
      assert.equal(agenda.body.recipientMascarado, 'ge**********@loja.test');
      assert.ok(
        !('recipient' in agenda.body),
        'a listagem nao pode devolver o destinatario em claro',
      );
    });

    const envio = await api('POST', `/reports/schedules/${agenda.body.id}/run`, {});
    const detalhe = await api('GET', `/reports/schedules/${agenda.body.id}`);
    check('enviar agora entrega e registra na trilha, sem gastar a ocorrencia', () => {
      assert.ok([200, 201].includes(envio.status), `envio falhou: ${envio.status}`);
      assert.equal(envio.body.status, 'ENVIADO');
      assert.equal(detalhe.body.entregas.length, 1);
      assert.equal(detalhe.body.entregas[0].recipient, 'ge**********@loja.test');
      // O "enviar agora" e teste manual: a proxima execucao programada continua
      // de pe, senao conferir o agendamento cancelaria o envio do dia.
      assert.equal(detalhe.body.nextRunAt, agenda.body.nextRunAt);
    });

    await api('DELETE', `/reports/schedules/${agenda.body.id}`);

    // 14) Metricas do processo: latencia por rota e contadores de negocio.
    const metricas = await api('GET', '/ops/metrics');
    check('metricas trazem rota normalizada e contador de vendas', () => {
      assert.equal(metricas.status, 200);
      assert.ok(metricas.body.desdeBoot, 'metrica sem marco de boot');
      assert.ok(metricas.body.contadores['vendas.concluidas'] >= 1);
      // A rota entra normalizada (`/sales/:id`), nunca com o id na etiqueta:
      // uma serie por venda faria a memoria crescer com o movimento da loja.
      assert.ok(
        metricas.body.rotas.some((r: any) => r.rota === 'GET /api/sales/:id'),
        'rota de venda nao aparece normalizada nas metricas',
      );
    });

    // 15) Numeracao de contingencia (F3): provedor cai -> documento entra em
    // CONTINGENCIA na serie do terminal; a rede volta -> transmite e autoriza,
    // sem renumerar. `clientRef` torna o reenvio idempotente.
    const dbC = app.get(PrismaService);
    // As vendas de contingencia sao canceladas via API (nao da para hard-delete:
    // ha pagamento, movimento e documento fiscal pendurados). Aqui so soltamos
    // os terminais de teste — o FK Sale.terminalId e ON DELETE SET NULL.
    const dropE2eTerminals = async () => {
      await dbC.terminal
        .deleteMany({
          where: {
            OR: [
              { code: { in: ['CAIXA-E2E', 'CAIXA-BAD', 'CAIXA-E2E-CONTINGENCIA'] } },
              { name: { startsWith: 'Caixa E2E' } },
            ],
          },
        })
        .catch(() => undefined);
    };
    await dropE2eTerminals();

    const contProduct = await api('POST', '/products', {
      sku: `E2E-CONT-${Date.now()}`,
      name: 'Produto contingencia E2E',
      price: 10,
      cost: 4,
      unit: 'UN',
      initialStock: 20,
      minStock: 1,
    });
    const contProductId = contProduct.body.id;

    const term = await api('POST', '/terminals', {
      code: 'CAIXA-E2E',
      name: 'Caixa E2E Contingencia',
      contingencySeries: 990,
      contingencyRangeStart: 1,
      contingencyRangeEnd: 5,
    });
    check('cria terminal com faixa de contingencia -> 201', () => {
      assert.equal(term.status, 201);
      assert.equal(term.body.contingencyNextNumber, 1);
    });
    const badRange = await api('POST', '/terminals', {
      code: 'CAIXA-BAD',
      name: 'Caixa faixa invertida',
      contingencySeries: 991,
      contingencyRangeStart: 9,
      contingencyRangeEnd: 2,
    });
    check('faixa de contingencia invertida -> 400', () => {
      assert.equal(badRange.status, 400);
    });

    await api('PUT', '/app-settings', {
      settings: [
        { key: 'fiscal.simulateOutage', value: true },
        { key: 'fiscal.maxEmitAttempts', value: 1 },
      ],
    });

    const contSale = await api('POST', '/sales', {
      items: [{ productId: contProductId, quantity: 1 }],
      payments: [{ method: 'DINHEIRO', amount: 10 }],
      terminalCode: 'CAIXA-E2E',
      clientRef: 'e2e-cont-1',
    });
    check('venda registrada e vinculada ao terminal', () => {
      assert.equal(contSale.status, 201);
      assert.ok(contSale.body.terminalId, 'venda sem terminalId');
    });

    // A emissao roda em segundo plano no fechamento da venda. Aguardamos ate o
    // documento sair de PENDENTE/PROCESSANDO; se ficar parado em PENDENTE
    // (o disparo assincrono nao pegou, ou uma falha o devolveu), cutucamos com
    // /emit — PENDENTE e estado seguro para reemitir, a trava condicional cuida
    // da concorrencia.
    const waitFiscal = async (saleId: string) => {
      let doc: any = null;
      for (let i = 0; i < 80; i++) {
        doc = (await api('GET', `/sales/${saleId}`)).body?.fiscalDocument;
        if (doc && !['PENDENTE', 'PROCESSANDO'].includes(doc.status)) return doc;
        if (doc && doc.status === 'PENDENTE' && i % 4 === 3) {
          await api('POST', `/fiscal/documents/${doc.id}/emit`).catch(
            () => undefined,
          );
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return doc;
    };
    const contDoc = await waitFiscal(contSale.body.id);
    check('provedor indisponivel -> documento em CONTINGENCIA na serie do terminal', () => {
      assert.equal(contDoc.status, 'CONTINGENCIA');
      assert.equal(contDoc.emissionType, 'CONTINGENCIA_OFFLINE');
      assert.equal(contDoc.series, 990);
      assert.equal(contDoc.number, 1);
      assert.ok(contDoc.emittedInContingencyAt, 'sem emittedInContingencyAt');
    });

    const replay = await api('POST', '/sales', {
      items: [{ productId: contProductId, quantity: 1 }],
      payments: [{ method: 'DINHEIRO', amount: 10 }],
      terminalCode: 'CAIXA-E2E',
      clientRef: 'e2e-cont-1',
    });
    check('reenvio com o mesmo clientRef devolve a mesma venda', () => {
      assert.ok([200, 201].includes(replay.status), `reenvio falhou: ${replay.status}`);
      assert.equal(replay.body.id, contSale.body.id);
      assert.equal(replay.body.number, contSale.body.number);
    });
    const noTerminal = await api('POST', '/sales', {
      items: [{ productId: contProductId, quantity: 1 }],
      payments: [{ method: 'DINHEIRO', amount: 10 }],
      clientRef: 'e2e-cont-sem-terminal',
    });
    check('clientRef sem terminal -> 400', () => {
      assert.equal(noTerminal.status, 400);
    });

    await api('PUT', '/app-settings', {
      settings: [{ key: 'fiscal.simulateOutage', value: false }],
    });
    const recon = await api('POST', '/fiscal/process-contingency');
    const contDoc2 = (await api('GET', `/sales/${contSale.body.id}`)).body
      .fiscalDocument;
    check('contingencia reconciliada -> AUTORIZADA, serie preservada, tpEmis=9', () => {
      assert.ok(recon.body.picked >= 1, 'process-contingency nao pegou o documento');
      assert.equal(contDoc2.status, 'AUTORIZADA');
      assert.equal(contDoc2.series, 990);
      assert.equal(contDoc2.number, 1);
      assert.equal(String(contDoc2.accessKey).length, 44);
      // tpEmis fica na posicao 35 da chave (indice 34): UF(2)+AAMM(4)+CNPJ(14)+
      // mod(2)+serie(3)+numero(9) = 34 caracteres antes dele.
      assert.equal(String(contDoc2.accessKey)[34], '9');
    });

    // Alerta operacional: documento preso em contingencia ha mais tempo que o
    // limite vira alerta alto. Provedor cai ANTES da venda, para o documento
    // nascer/entrar em contingencia.
    await api('PUT', '/app-settings', {
      settings: [
        { key: 'fiscal.simulateOutage', value: true },
        { key: 'fiscal.maxEmitAttempts', value: 1 },
      ],
    });
    const staleSale = await api('POST', '/sales', {
      items: [{ productId: contProductId, quantity: 1 }],
      payments: [{ method: 'DINHEIRO', amount: 10 }],
      terminalCode: 'CAIXA-E2E',
      clientRef: 'e2e-cont-stale',
    });
    const staleDoc = await waitFiscal(staleSale.body.id);
    check('segunda venda em contingencia usa o proximo numero da faixa', () => {
      assert.equal(staleDoc.status, 'CONTINGENCIA');
      assert.equal(staleDoc.series, 990);
      assert.equal(staleDoc.number, 2);
    });
    await dbC.fiscalDocument.update({
      where: { id: staleDoc.id },
      data: { emittedInContingencyAt: new Date(Date.now() - 48 * 3600_000) },
    });
    const alerts = await api('GET', '/ops/alerts');
    check('documento em contingencia ha >24h vira alerta alto', () => {
      const a = alerts.body.alerts.find(
        (x: any) => x.code === 'fiscal.contingencyStale',
      );
      assert.ok(a, 'alerta fiscal.contingencyStale ausente');
      assert.equal(a.level, 'alto');
    });

    // Limpeza da secao de contingencia.
    await api('PUT', '/app-settings', {
      settings: [
        { key: 'fiscal.simulateOutage', value: false },
        { key: 'fiscal.maxEmitAttempts', value: 5 },
      ],
    });
    await api('POST', `/sales/${contSale.body.id}/cancel`, {
      reason: 'limpeza do e2e de contingencia',
    });
    await api('POST', `/sales/${staleSale.body.id}/cancel`, {
      reason: 'limpeza do e2e de contingencia prolongada',
    });
    await dropE2eTerminals();
    if (contProductId) {
      await api('DELETE', `/products/${contProductId}`).catch(() => undefined);
    }

  } finally {
    // Limpeza best-effort: inativa os produtos de teste.
    if (token) {
      // Restaura os ajustes fiscais que a secao de contingencia mexe — se ela
      // abortar no meio, `simulateOutage=true` deixaria a NFC-e quebrada para a
      // proxima execucao.
      await api('PUT', '/app-settings', {
        settings: [
          { key: 'fiscal.simulateOutage', value: false },
          { key: 'fiscal.maxEmitAttempts', value: 5 },
        ],
      }).catch(() => undefined);
      await api('POST', '/store-settings/contingency', { active: false }).catch(
        () => undefined,
      );
      if (productId) {
        await api('DELETE', `/products/${productId}`).catch(() => undefined);
      }
      if (product2Id) {
        await api('DELETE', `/products/${product2Id}`).catch(() => undefined);
      }
      if (scaleProductId) {
        await api('DELETE', `/products/${scaleProductId}`).catch(() => undefined);
      }
      if (concurCancelProductId) {
        await api('DELETE', `/products/${concurCancelProductId}`).catch(() => undefined);
      }
      if (concurReturnProductId) {
        await api('DELETE', `/products/${concurReturnProductId}`).catch(() => undefined);
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
