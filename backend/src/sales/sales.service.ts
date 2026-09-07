import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { MetricsService } from '../common/metrics.service';
import { AuthorizationService } from '../access/authorization.service';
import { ReceivablesService } from '../finance/receivables.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PaymentsService } from '../payments/payments.service';
import { PromotionsService } from '../promotions/promotions.service';
import { LicenseService } from '../license/license.service';
import { AppSettingsService } from '../settings/app-settings.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// Chaves de advisory lock (transacional) que serializam numeracoes concorrentes.
const SALE_NUMBER_LOCK = 727274;
const RETURN_NUMBER_LOCK = 727275;

@Injectable()
export class SalesService {
  private readonly log = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscal: FiscalService,
    private readonly payments: PaymentsService,
    private readonly access: AccessService,
    private readonly authorization: AuthorizationService,
    private readonly promotions: PromotionsService,
    private readonly license: LicenseService,
    private readonly receivables: ReceivablesService,
    private readonly loyalty: LoyaltyService,
    private readonly settings: AppSettingsService,
    private readonly metrics: MetricsService,
  ) {}

  list(params: { status?: string; take?: number }) {
    const status =
      params.status && params.status in SaleStatus
        ? (params.status as SaleStatus)
        : undefined;

    return this.prisma.sale.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
      include: {
        customer: true,
        operator: { select: { id: true, name: true } },
        _count: { select: { items: true } },
        payments: true,
        fiscalDocument: true,
      },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        operator: { select: { id: true, name: true } },
        items: { include: { product: true } },
        payments: true,
        fiscalDocument: true,
        returns: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            operator: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    return sale;
  }

  async create(dto: CreateSaleDto, operatorId: string, grantToken?: string) {
    if (!operatorId) throw new BadRequestException('Operador nao identificado.');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { stock: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // O preco unitario e SEMPRE o cadastrado no produto — nunca vem do cliente.
    const lines = dto.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Produto ${item.productId} nao encontrado.`);
      }
      if (!product.active) {
        throw new BadRequestException(`Produto "${product.name}" esta inativo.`);
      }
      const qty = D(item.quantity);
      const unitPrice = D(product.price);
      const gross = unitPrice.mul(qty);
      const discount = D(item.discount ?? 0);
      if (discount.gt(gross)) {
        throw new BadRequestException(
          `Desconto do item "${product.name}" maior que o valor do item.`,
        );
      }
      return {
        product,
        qty,
        unitPrice,
        // Snapshot do custo, do mesmo jeito que o preco: a margem de uma venda
        // e um fato do dia em que ela aconteceu. Sem gravar aqui, uma
        // reprecificacao de fornecedor amanha reescreveria o CMV de hoje, e o
        // DRE de um periodo ja fechado mudaria sozinho.
        unitCost: product.cost === null ? null : D(product.cost),
        gross,
        // Desconto digitado pelo operador. A promocao entra depois, separada,
        // porque as duas respondem a politicas diferentes.
        manualDiscount: discount,
        promoDiscount: D(0),
        promotionId: null as string | null,
        promotionName: null as string | null,
        discount,
        total: gross.minus(discount),
      };
    });

    // Promocao e decisao do SERVIDOR: o PDV so simula para mostrar ao cliente.
    // Recalculamos aqui com a mesma funcao da simulacao — se divergisse, o
    // cliente veria um preco na tela e pagaria outro.
    // O gate de licenca precisa estar AQUI, no ponto de aplicacao, e nao so na
    // rota de consulta: com o modulo fora, o PDV para de simular e mostra o
    // preco cheio, mas o servidor continuava descontando. No cartao a venda
    // falhava com 400 no balcao; no dinheiro o Z fechava com sobra.
    const promocoesLicenciadas = await this.license.allows('promocoes');
    // Sem o modulo Fiscal, a venda NAO cria documento nem consome numeracao de
    // NFC-e. Consumir a sequencia numa instalacao que nao pagou o modulo deixa
    // buracos que a habilitacao posterior herda — e a numeracao fiscal e do
    // emitente, nao do software.
    const fiscalLicenciado = await this.license.allows('fiscal');

    // Passa o carrinho com os precos que ESTA venda leu. Deixar o motor reler
    // do banco abria janela para as duas contas usarem precos diferentes.
    const promo = promocoesLicenciadas
      ? await this.promotions.computeForCart(
          lines.map((l) => ({
            productId: l.product.id,
            categoryId: l.product.categoryId,
            unitPrice: l.unitPrice,
            quantity: l.qty,
            pricingMode: l.product.pricingMode as 'UNIT' | 'WEIGHT',
          })),
        )
      : { lines: [] };
    for (const applied of promo.lines) {
      const line = lines[applied.index];
      if (!line) continue;
      // Manual + promocional nunca passa do bruto da linha.
      const room = line.gross.minus(line.manualDiscount);
      const promoDiscount = applied.discount.gt(room) ? room : applied.discount;
      if (promoDiscount.lte(0)) continue;
      line.promoDiscount = promoDiscount;
      line.promotionId = applied.promotionId;
      line.promotionName = applied.promotionName;
      line.discount = line.manualDiscount.plus(promoDiscount);
      line.total = line.gross.minus(line.discount);
    }

    const subtotal = lines.reduce((acc, l) => acc.plus(l.total), D(0));
    const saleDiscount = D(dto.discount ?? 0);
    const total = subtotal.minus(saleDiscount);
    if (total.lt(0)) throw new BadRequestException('Desconto maior que o total.');

    // Politica de desconto: quem nao tem "sales.discountOverride" respeita o
    // teto (em %) da loja — a menos que um supervisor libere na hora.
    let discountApprover: string | null = null;
    let mayOverride = await this.access.can(operatorId, 'sales.discountOverride');
    if (!mayOverride) {
      discountApprover = this.authorization.consume(
        grantToken,
        operatorId,
        'sales.discountOverride',
      );
      mayOverride = !!discountApprover;
    }
    if (!mayOverride) {
      const gross = lines.reduce((acc, l) => acc.plus(l.unitPrice.mul(l.qty)), D(0));
      if (gross.gt(0)) {
        const settings = await this.prisma.storeSettings.findFirst({
          select: { maxDiscountPercentOperator: true },
        });
        const limit = D(settings?.maxDiscountPercentOperator ?? 100);
        // Só o desconto CONCEDIDO pelo operador conta contra o teto. Promocao e
        // campanha da loja: se entrasse na conta, uma promocao agressiva
        // travaria o caixa por um desconto que ele nao deu.
        const manual = lines
          .reduce((acc, l) => acc.plus(l.manualDiscount), D(0))
          .plus(saleDiscount);
        const pct = manual.div(gross).mul(100);
        if (pct.gt(limit)) {
          throw new BadRequestException(
            `Desconto de ${pct.toFixed(1)}% excede o limite de ${limit.toFixed(
              0,
            )}% da loja. Peca a liberacao de um supervisor.`,
          );
        }
      }
    }

    const paid = dto.payments.reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    if (paid.lt(total)) {
      throw new BadRequestException(
        `Pagamento (${paid}) menor que o total da venda (${total}).`,
      );
    }

    // Troco so existe em dinheiro: a soma dos pagamentos eletronicos nao pode
    // ultrapassar o total da venda.
    const nonCashPaid = dto.payments
      .filter((p) => p.method !== 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    if (nonCashPaid.gt(total)) {
      throw new BadRequestException(
        `Pagamento eletronico (${nonCashPaid}) excede o total da venda (${total}) — nao ha troco.`,
      );
    }

    const cashPaid = dto.payments
      .filter((p) => p.method === 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));

    // ------------------------------------------------------------ Crediario
    // A partir daqui "Crediário" deixa de ser rotulo: cada parcela vira titulo
    // a receber, e o limite do cliente e conferido ANTES de a mercadoria sair.
    const crediarioLines = dto.payments.filter((p) => p.method === 'CREDIARIO');
    const crediarioTotal = crediarioLines.reduce(
      (acc, p) => acc.plus(D(p.amount)),
      D(0),
    );
    const financeiroLicenciado = await this.license.allows('financeiro');
    if (crediarioTotal.gt(0)) {
      if (!financeiroLicenciado) {
        throw new BadRequestException(
          'Venda a prazo exige o modulo Financeiro, que nao esta na licenca ' +
            'desta instalacao. Use outra forma de pagamento.',
        );
      }
      if (!dto.customerId) {
        throw new BadRequestException(
          'Venda no crediario exige cliente identificado — o titulo precisa de dono.',
        );
      }
      // O limite disponivel e conferido DENTRO da transacao, sob lock por
      // cliente — ver ReceivablesService.assertCreditAvailable.
    }
    // Uma linha de crediario pode ser parcelada; varias linhas somam parcelas.
    const crediarioInstallments = crediarioLines.reduce(
      (acc, p) => acc + Math.max(1, p.installments ?? 1),
      0,
    );
    if (crediarioInstallments > 0) {
      // O teto do DTO impede o absurdo (um laco de INSERT segurando o lock da
      // numeracao); este e o limite comercial que a loja configurou.
      const maxParcelas = await this.settings.getNumber('sales.maxInstallments');
      if (crediarioInstallments > maxParcelas) {
        throw new BadRequestException(
          'Crediario em ' +
            crediarioInstallments +
            ' parcelas excede o maximo de ' +
            maxParcelas +
            ' da loja.',
        );
      }
    }

    // ----------------------------------------------------------- Fidelidade
    const loyaltyTotal = dto.payments
      .filter((p) => p.method === 'FIDELIDADE')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    const fidelidadeLicenciada = await this.license.allows('promocoes');
    const loyaltyConfig = await this.loyalty.config();
    /** Supervisor que liberou o resgate, quando o operador nao tinha a permissao. */
    let redeemApprover: string | null = null;

    if (loyaltyTotal.gt(0)) {
      if (!fidelidadeLicenciada || !loyaltyConfig.enabled) {
        throw new BadRequestException(
          'O programa de fidelidade nao esta ativo nesta instalacao.',
        );
      }
      if (!dto.customerId) {
        throw new BadRequestException(
          'Resgate de fidelidade exige cliente identificado.',
        );
      }
      // Limites primeiro, vale depois: o vale e de uso unico, e gasta-lo para
      // recusar em seguida por um erro de digitacao obriga o supervisor a
      // digitar a senha outra vez — atrito que empurra a loja para o habito de
      // senha compartilhada (SEC-070).
      if (loyaltyTotal.lt(loyaltyConfig.minRedeem)) {
        throw new BadRequestException(
          `Resgate minimo de R$ ${D(loyaltyConfig.minRedeem).toFixed(2)}.`,
        );
      }
      const teto = total.mul(loyaltyConfig.maxRedeemPercent).div(100);
      if (loyaltyTotal.gt(teto)) {
        throw new BadRequestException(
          `Resgate limitado a ${loyaltyConfig.maxRedeemPercent}% da venda ` +
            `(R$ ${teto.toFixed(2)}).`,
        );
      }
      // Resgate e dinheiro do cliente saindo de uma conta: nao e o mesmo que
      // registrar uma venda. Quem opera sem a permissao pede liberacao.
      let mayRedeem = await this.access.can(operatorId, 'loyalty.redeem');
      if (!mayRedeem) {
        redeemApprover = this.authorization.consume(
          grantToken,
          operatorId,
          'loyalty.redeem',
        );
        mayRedeem = !!redeemApprover;
      }
      if (!mayRedeem) {
        throw new BadRequestException(
          'Sem permissao para resgatar saldo de fidelidade. Peca a liberacao de um supervisor.',
        );
      }
    }

    const installmentIntervalDays = await this.settings.getNumber(
      'finance.installmentIntervalDays',
    );

    let cashback = D(0);
    const sale = await this.prisma.$transaction(async (tx) => {
      // Serializa a alocacao de numero de venda entre transacoes concorrentes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SALE_NUMBER_LOCK})`;

      const openSession = await tx.cashSession.findFirst({
        where: { operatorId, status: 'ABERTA' },
        select: { id: true },
      });

      const last = await tx.sale.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      // Baixa de estoque atomica e condicional (impede venda a descoberto sob concorrencia).
      for (const l of lines) {
        const updated = await tx.stockItem.updateMany({
          where: { productId: l.product.id, quantity: { gte: l.qty } },
          data: { quantity: { decrement: l.qty } },
        });
        if (updated.count !== 1) {
          throw new BadRequestException(
            `Estoque insuficiente para "${l.product.name}".`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          number,
          status: 'CONCLUIDA',
          subtotal,
          discount: saleDiscount,
          total,
          note: dto.note,
          terminal: dto.terminal?.trim() || null,
          customerId: dto.customerId ?? null,
          operatorId,
          cashSessionId: openSession?.id ?? null,
          completedAt: new Date(),
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              description: l.product.name,
              quantity: l.qty,
              unitPrice: l.unitPrice,
              unitCost: l.unitCost,
              discount: l.discount,
              // Snapshot da campanha: a promocao pode ser editada ou apagada
              // depois, e o item da venda tem de continuar explicando o preco.
              promoDiscount: l.promoDiscount,
              promotionId: l.promotionId,
              promotionName: l.promotionName,
              total: l.total,
            })),
          },
          payments: {
            create: dto.payments.map((p) => ({
              method: p.method,
              amount: D(p.amount),
              // Parcelamento so faz sentido no credito.
              installments: p.method === 'CREDITO' ? p.installments ?? 1 : null,
              // Quem liquida no balcao ja nasce CONFIRMADO; quem depende de
              // terceiro nasce PENDENTE e e autorizado apos o commit.
              status: this.payments.initialStatus(p.method),
              provider: this.payments.providerName(p.method),
            })),
          },
        },
        include: { items: true, payments: true },
      });

      for (const l of lines) {
        await tx.stockMovement.create({
          data: {
            productId: l.product.id,
            type: 'VENDA',
            quantity: l.qty.negated(),
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // O que fica na gaveta e o total MENOS o que foi pago por fora dela.
      // Antes lancavamos `min(cashPaid, total)`: numa venda de R$ 100 com
      // R$ 50 de saldo de fidelidade e R$ 100 entregues em especie, o troco de
      // R$ 50 saia da gaveta mas o lancamento registrava R$ 100 — e o Z fechava
      // acusando falta contra o operador (SEC-065).
      const cashKept = Prisma.Decimal.max(
        D(0),
        Prisma.Decimal.min(cashPaid, total.minus(nonCashPaid)),
      );
      if (openSession && cashKept.gt(0)) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            type: 'VENDA',
            amount: cashKept,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // Fidelidade: DEBITA o saldo dentro da transacao. Fora dela, uma falha
      // posterior deixaria a venda paga com um saldo que nunca saiu da conta.
      if (loyaltyTotal.gt(0) && dto.customerId) {
        await this.loyalty.redeem(tx, {
          customerId: dto.customerId,
          amount: loyaltyTotal,
          saleId: sale.id,
          userId: operatorId,
          reason: `Resgate na venda #${sale.number}`,
        });
      }

      // Crediario: uma linha por parcela, vencimentos espacados pelo intervalo
      // configurado. Nasce aqui, com a venda, e nao depois: a janela entre
      // "venda existe" e "divida existe" e exatamente o buraco que o titulo
      // veio fechar.
      if (crediarioTotal.gt(0) && dto.customerId) {
        await this.receivables.assertCreditAvailable(
          tx,
          dto.customerId,
          crediarioTotal,
        );
        await this.receivables.createForSale(tx, {
          customerId: dto.customerId,
          saleId: sale.id,
          saleNumber: sale.number,
          total: crediarioTotal,
          installments: crediarioInstallments,
          intervalDays: installmentIntervalDays,
        });
      }

      // Cashback sobre o dinheiro NOVO: o que foi pago com saldo nao gera
      // saldo. A venda a prazo gera — a mercadoria saiu e a divida existe.
      if (
        fidelidadeLicenciada &&
        loyaltyConfig.enabled &&
        loyaltyConfig.cashbackPercent > 0 &&
        dto.customerId
      ) {
        cashback = await this.loyalty.accrue(tx, {
          customerId: dto.customerId,
          base: total.minus(loyaltyTotal),
          percent: loyaltyConfig.cashbackPercent,
          saleId: sale.id,
          userId: operatorId,
        });
      }

      // Cria o documento fiscal PENDENTE dentro da transacao (numeracao da
      // NFC-e). A emissao junto ao provedor acontece fora da transacao, logo
      // apos o commit, para nao segurar o PDV.
      const store = fiscalLicenciado
        ? await tx.storeSettings.findFirst({
            select: { id: true, nfceSeries: true, nfceEnvironment: true },
          })
        : null;
      if (store) {
        const bumped = await tx.storeSettings.update({
          where: { id: store.id },
          data: { nfceNextNumber: { increment: 1 } },
          select: { nfceNextNumber: true },
        });
        await tx.fiscalDocument.create({
          data: {
            saleId: sale.id,
            model: 65,
            series: store.nfceSeries,
            number: bumped.nfceNextNumber - 1,
            status: 'PENDENTE',
            environment: store.nfceEnvironment,
          },
        });
      }

      return sale;
    });

    if (discountApprover) {
      await this.authorization.record({
        action: 'sales.discountOverride',
        permissionKey: 'sales.discountOverride',
        actorId: operatorId,
        approverId: discountApprover,
        targetType: 'Sale',
        targetId: sale.id,
        detail: { number: sale.number, total: String(total), discount: String(saleDiscount) },
      });
    }

    // Resgate de saldo e venda a prazo movem dinheiro do cliente: entram na
    // trilha com quem executou e, quando houve vale, quem liberou. Sem isto, um
    // operador sem `loyalty.redeem` podia gastar o saldo de um cliente com um
    // vale de supervisor e nao sobrava registro de quem autorizou (SEC-062).
    if (loyaltyTotal.gt(0) && dto.customerId) {
      await this.authorization.record({
        action: 'loyalty.redeem',
        permissionKey: 'loyalty.redeem',
        actorId: operatorId,
        approverId: redeemApprover ?? undefined,
        targetType: 'Customer',
        targetId: dto.customerId,
        detail: { venda: sale.number, valor: String(loyaltyTotal) },
      });
    }
    if (crediarioTotal.gt(0) && dto.customerId) {
      await this.authorization.record({
        action: 'sales.credit',
        actorId: operatorId,
        targetType: 'Customer',
        targetId: dto.customerId,
        detail: {
          venda: sale.number,
          valor: String(crediarioTotal),
          parcelas: crediarioInstallments,
        },
      });
    }

    // Contadores de negocio: latencia de rota nao responde "o balcao vendeu
    // hoje?". Estes numeros respondem, e sao os que a loja pergunta quando
    // desconfia que alguma coisa parou.
    this.metrics.increment('vendas.concluidas');
    this.metrics.increment('vendas.itens', lines.length);

    // Autorizacao dos pagamentos que passam por gateway. Fora da transacao,
    // pela mesma razao da emissao fiscal: chamada externa nao segura lock de
    // banco. Uma recusa deixa o pagamento NEGADO — a venda ja tem numero e ja
    // baixou estoque, entao o desfecho e o cancelamento, nao um rollback.
    await this.payments.settleSale(sale.id).catch((err) => {
      this.log.error(
        `Falha ao autorizar pagamentos da venda ${sale.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    });

    // Emissao fiscal assincrona: o resultado (AUTORIZADA/REJEITADA) fica no
    // proprio documento; uma falha aqui nunca invalida a venda ja concluida.
    if (fiscalLicenciado) {
      void this.fiscal.emitForSale(sale.id).catch((err) => {
        this.log.error(
          `Falha ao disparar emissao fiscal da venda ${sale.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      });
    }

    // Os pagamentos mudaram de estado depois do commit: devolve o que ficou
    // gravado, para o recibo do PDV mostrar autorizacao e QR de verdade.
    return {
      ...sale,
      payments: await this.payments.listForCheckout(sale.id),
      // O recibo do PDV mostra o saldo que o cliente ganhou: e o unico momento
      // em que ele esta na frente do operador para ouvir isso.
      loyaltyEarned: cashback,
    };
  }

  async cancel(
    id: string,
    dto: CancelSaleDto,
    operatorId: string,
    approverId?: string,
  ) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        fiscalDocument: true,
        cashSession: true,
        // O cancelamento tem de descontar o que uma devolucao anterior ja
        // repos de estoque e ja reembolsou em dinheiro — senao devolve tudo
        // outra vez, e mercadoria e caixa saem em dobro (SEC-073).
        returns: { include: { items: true } },
      },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    if (sale.status !== 'CONCLUIDA') {
      throw new BadRequestException(
        'Somente vendas concluidas podem ser canceladas.',
      );
    }
    if (sale.cashSession && sale.cashSession.status === 'FECHADA') {
      throw new BadRequestException(
        'O caixa desta venda ja foi fechado. Faca o estorno contabil manualmente.',
      );
    }

    // Quanto entrou de fato na gaveta: o dinheiro entregue, menos o troco.
    // A conta espelha a da venda (SEC-065) — usar `min(cashBooked, total)`
    // ignorava que parte do total tinha sido paga por fora da gaveta
    // (crediario, saldo de fidelidade, cartao), e o cancelamento devolvia em
    // especie mais do que a loja havia recebido.
    const recebido = (metodo: (m: string) => boolean) =>
      sale.payments
        .filter((p) => metodo(p.method) && p.status !== 'NEGADO' && p.status !== 'ESTORNADO')
        .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    const cashBooked = recebido((m) => m === 'DINHEIRO');
    const nonCashBooked = recebido((m) => m !== 'DINHEIRO');
    const cashEntrou = Prisma.Decimal.max(
      D(0),
      Prisma.Decimal.min(cashBooked, D(sale.total).minus(nonCashBooked)),
    );

    // O que a devolucao ja tirou da gaveta nao pode sair de novo — e o que ela
    // tirou e `cashRefunded`, nao o total dela: numa venda paga metade com
    // saldo de fidelidade, a devolucao de metade sangra um quarto do valor.
    // Usar o total bruto fazia o cancelamento reter dinheiro do cliente e
    // deixar sobra inexplicada no Z (SEC-076).
    const jaReembolsadoEmDinheiro = sale.returns
      .filter((r) => r.refundMethod === 'DINHEIRO')
      .reduce((acc, r) => acc.plus(D(r.cashRefunded)), D(0));
    const cashToReverse = Prisma.Decimal.max(
      D(0),
      cashEntrou.minus(jaReembolsadoEmDinheiro),
    );

    // Quantidade ja devolvida por item da venda: o cancelamento repoe so o
    // saldo que ainda esta com o cliente.
    const jaDevolvido = new Map<string, Prisma.Decimal>();
    for (const r of sale.returns) {
      for (const ri of r.items) {
        jaDevolvido.set(
          ri.saleItemId,
          (jaDevolvido.get(ri.saleItemId) ?? D(0)).plus(ri.quantity),
        );
      }
    }

    let titulosPendentes = 0;
    const canceled = await this.prisma.$transaction(async (tx) => {
      // Reivindica a venda ANTES de qualquer efeito. Sem isto, dois
      // cancelamentos simultaneos passavam os dois pela checagem la em cima
      // (feita fora da transacao, portanto um TOCTOU) e cada um estornava
      // estoque e lancava sua propria sangria — dinheiro e mercadoria
      // duplicados por uma corrida que nao exige nada alem de duas
      // requisicoes paralelas (SEC-047).
      const claim = await tx.sale.updateMany({
        where: { id, status: 'CONCLUIDA' },
        data: {
          status: 'CANCELADA',
          canceledAt: new Date(),
          cancelReason: dto.reason,
        },
      });
      if (claim.count !== 1) {
        throw new BadRequestException(
          'Esta venda ja foi cancelada por outra requisicao.',
        );
      }

      for (const item of sale.items) {
        const restante = D(item.quantity).minus(jaDevolvido.get(item.id) ?? D(0));
        if (restante.lte(0)) continue;
        await tx.stockItem.updateMany({
          where: { productId: item.productId },
          data: { quantity: { increment: restante } },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'DEVOLUCAO',
            quantity: restante,
            reason: `Cancelamento da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // Estorna a entrada de dinheiro no caixa, para a conciliacao do
      // fechamento nao acusar sobra/falta indevida.
      if (sale.cashSessionId && cashToReverse.gt(0)) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: sale.cashSessionId,
            type: 'SANGRIA',
            amount: cashToReverse,
            reason: `Estorno da venda #${sale.number} (cancelamento)`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // Crediario: derruba as parcelas que ninguem tocou. Titulo com baixa
      // parcial fica de pe de proposito — parte do dinheiro entrou e apagar o
      // titulo esconderia essa entrada.
      titulosPendentes = (
        await this.receivables.cancelForSale(tx, sale.id, sale.number)
      ).pending;

      return tx.sale.findUniqueOrThrow({ where: { id } });
    });

    await this.authorization.record({
      action: 'sales.cancel',
      permissionKey: 'sales.cancel',
      actorId: operatorId,
      approverId,
      targetType: 'Sale',
      targetId: sale.id,
      detail: { number: sale.number, total: String(sale.total), reason: dto.reason },
    });

    // Estorna os pagamentos junto aos provedores. O dinheiro em especie ja
    // voltou para a gaveta pelo CashMovement acima; aqui fecha o ciclo do
    // cartao/Pix e marca cada pagamento como ESTORNADO.
    const notRefunded = await this.payments
      .refundSale(sale.id, `Cancelamento da venda #${sale.number}: ${dto.reason}`, operatorId)
      .catch((err) => {
        this.log.error(
          `Falha ao estornar pagamentos da venda ${sale.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return [] as Array<{ id: string; method: string; amount: string }>;
      });

    // Venda cancelada sai do escopo do X/Z, entao um estorno que falhou nao
    // apareceria em relatorio nenhum. A trilha e o unico lugar onde consta que
    // o dinheiro NAO voltou ao cliente.
    if (notRefunded.length > 0) {
      this.log.error(
        `Venda ${sale.id} cancelada com ${notRefunded.length} pagamento(s) nao estornado(s).`,
      );
      await this.authorization.record({
        action: 'sales.cancel.refundPending',
        actorId: operatorId,
        approverId,
        targetType: 'Sale',
        targetId: sale.id,
        detail: { number: sale.number, payments: notRefunded },
      });
    }

    // Fidelidade: devolve ao cliente o saldo que ele resgatou e retira o
    // cashback desta venda. Roda apos o commit — e um efeito sobre a conta do
    // cliente, nao sobre a venda, e uma falha aqui nao pode desfazer o
    // cancelamento que ja estornou estoque e caixa.
    await this.loyalty.reverseSale(sale.id, operatorId).catch((err) => {
      this.log.error(
        `Falha ao estornar fidelidade da venda ${sale.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    });

    // Titulo com baixa parcial sobrou em aberto: o gerente precisa resolver a
    // mao, e a trilha e o unico lugar onde isso fica registrado.
    if (titulosPendentes > 0) {
      await this.authorization.record({
        action: 'sales.cancel.receivablePending',
        actorId: operatorId,
        approverId,
        targetType: 'Sale',
        targetId: sale.id,
        detail: { number: sale.number, titulosEmAberto: titulosPendentes },
      });
    }

    // Cancela a NFC-e junto ao provedor (se ja autorizada) ou apenas marca o
    // documento; roda apos o commit para nao misturar chamada externa com a tx.
    if (sale.fiscalDocument) {
      await this.fiscal
        .cancelForSale(sale.id, `Cancelamento da venda #${sale.number}: ${dto.reason}`)
        .catch((err) => {
          this.log.error(
            `Falha ao cancelar documento fiscal da venda ${sale.id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
    }

    this.metrics.increment('vendas.canceladas');
    return canceled;
  }

  listReturns(saleId: string) {
    return this.prisma.saleReturn.findMany({
      where: { saleId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        operator: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Devolucao parcial (ou total) de itens de uma venda concluida. Nao mexe na
   * venda original: repoe estoque, registra o SaleReturn e, se o reembolso for
   * em dinheiro e houver caixa aberto do operador, langa uma sangria.
   */
  async createReturn(
    saleId: string,
    dto: CreateReturnDto,
    operatorId: string,
    approverId?: string,
  ) {
    const { saleReturn, saleNumber, rateio } = await this.prisma.$transaction(async (tx) => {
      // Serializa por VENDA. Antes, a leitura da venda e o calculo de
      // "quanto ja foi devolvido" aconteciam FORA da transacao — duas
      // devolucoes concorrentes do mesmo item liam o mesmo retrato, passavam
      // as duas pela validacao de saldo, e cada uma devolvia estoque e
      // lancava sua propria sangria para uma quantidade que so existia uma
      // vez (SEC-048). O lock e por venda (hash do id), nao global, para
      // devolucoes de vendas diferentes nao esperarem umas pelas outras.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${saleId}))`;

      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: true,
          payments: true,
          returns: { include: { items: true } },
        },
      });
      if (!sale) throw new NotFoundException('Venda nao encontrada.');
      if (sale.status !== 'CONCLUIDA') {
        throw new BadRequestException(
          'So e possivel devolver itens de vendas concluidas.',
        );
      }

      // Base do rateio do desconto de venda. Usamos a soma dos itens em vez de
      // `sale.subtotal` para nao depender de um campo que poderia divergir.
      const subtotalVenda = sale.items.reduce((acc, i) => acc.plus(i.total), D(0));

      const itemById = new Map(sale.items.map((i) => [i.id, i]));
      const returnedByItem = new Map<string, Prisma.Decimal>();
      for (const r of sale.returns) {
        for (const ri of r.items) {
          returnedByItem.set(
            ri.saleItemId,
            (returnedByItem.get(ri.saleItemId) ?? D(0)).plus(ri.quantity),
          );
        }
      }

      // Consolida quantidades repetidas do mesmo item na requisicao.
      const requested = new Map<string, Prisma.Decimal>();
      for (const it of dto.items) {
        requested.set(
          it.saleItemId,
          (requested.get(it.saleItemId) ?? D(0)).plus(D(it.quantity)),
        );
      }

      const lines = [...requested.entries()].map(([saleItemId, qty]) => {
        const original = itemById.get(saleItemId);
        if (!original) {
          throw new BadRequestException('Item informado nao pertence a esta venda.');
        }
        const remaining = D(original.quantity).minus(
          returnedByItem.get(saleItemId) ?? D(0),
        );
        if (qty.gt(remaining)) {
          throw new BadRequestException(
            `Quantidade a devolver de "${original.description}" (${qty}) maior que o disponivel (${remaining}).`,
          );
        }
        // Reembolso proporcional ao que foi efetivamente COBRADO.
        //
        // O `SaleItem.total` e liquido do desconto do item, mas nao do desconto
        // aplicado sobre a venda inteira — que fica so em `Sale.discount`.
        // Devolver o valor do item cheio numa venda que teve 20% de desconto no
        // total reembolsava mais do que o cliente pagou (SEC-072); em venda
        // paga com saldo de fidelidade isso ainda inflava o saldo devolvido.
        // Rateamos o desconto de venda pelo peso do item no subtotal.
        const rateioVenda = subtotalVenda.gt(0)
          ? D(sale.total).div(subtotalVenda)
          : D(1);
        const total = D(original.total)
          .div(original.quantity)
          .mul(qty)
          .mul(rateioVenda)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
        return { original, qty, unitPrice: D(original.unitPrice), total };
      });

      // O arredondamento por linha deixa centavos para tras: tres itens de
      // R$ 33,33 com 20% de desconto na venda somam R$ 79,99 numa devolucao
      // integral (SEC-077). Como em `createForSale`, o resto vai para a
      // PRIMEIRA linha — e a que o cliente confere primeiro no comprovante.
      // So corrigimos quando a devolucao e integral: numa parcial nao ha um
      // alvo exato contra o qual fechar.
      const devolveTudoDaVenda = lines.every((l) =>
        l.qty.equals(
          D(l.original.quantity).minus(returnedByItem.get(l.original.id) ?? D(0)),
        ),
      );
      if (devolveTudoDaVenda && lines.length === sale.items.length) {
        const somaLinhas = lines.reduce((acc, l) => acc.plus(l.total), D(0));
        const jaDevolvidoEmValor = sale.returns.reduce(
          (acc, r) => acc.plus(r.total),
          D(0),
        );
        const alvo = D(sale.total).minus(jaDevolvidoEmValor);
        const resto = alvo.minus(somaLinhas);
        if (!resto.isZero() && lines[0]) {
          const ajustado = lines[0].total.plus(resto);
          if (ajustado.gte(0)) lines[0].total = ajustado;
        }
      }

      const total = lines.reduce((acc, l) => acc.plus(l.total), D(0));

      // ------------------------------------------------------------------
      // Nem tudo que a venda cobrou virou dinheiro na mao da loja.
      //
      // O crediario e uma promessa de pagamento e o resgate de fidelidade e
      // credito que a propria loja tinha concedido. Devolver a venda inteira em
      // especie tirava da gaveta um valor que nunca entrou — e ainda deixava o
      // titulo em aberto, como se o cliente continuasse devendo (SEC-061).
      //
      // Entao a devolucao e rateada pelas formas de pagamento ORIGINAIS: a
      // fatia do crediario abate a divida, a fatia da fidelidade volta como
      // saldo, e so o que sobra pode sair em dinheiro.
      const saleTotal = D(sale.total);
      // So o que efetivamente entrou conta no rateio — pagamento negado ou ja
      // estornado nao e dinheiro recebido (SEC-075), mesmo criterio do X/Z.
      const somaPor = (metodo: string) =>
        sale.payments
          .filter(
            (p) =>
              p.method === metodo &&
              (p.status === 'AUTORIZADO' || p.status === 'CONFIRMADO'),
          )
          .reduce((acc, p) => acc.plus(p.amount), D(0));
      // `total` e a soma dos itens, BRUTA do desconto aplicado sobre a venda;
      // `sale.total` ja e liquido dele. Numa venda com desconto no total a
      // divisao passava de 1, e o rateio devolvia mais saldo de fidelidade do
      // que o cliente havia resgatado (SEC-072). A fracao nunca passa de 1: no
      // limite, devolve-se a venda inteira.
      const fracao = saleTotal.gt(0)
        ? Prisma.Decimal.min(D(1), total.div(saleTotal))
        : D(0);
      const fatiaCrediario = somaPor('CREDIARIO')
        .mul(fracao)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      const fatiaFidelidade = somaPor('FIDELIDADE')
        .mul(fracao)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      const reembolsavelEmDinheiro = Prisma.Decimal.max(
        D(0),
        total.minus(fatiaCrediario).minus(fatiaFidelidade),
      );

      // Serializa so a alocacao do NUMERO (sequencia global, como Sale.number)
      // — a validacao de saldo acima ja esta protegida pelo lock por venda.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RETURN_NUMBER_LOCK})`;

      const openSession = await tx.cashSession.findFirst({
        where: { operatorId, status: 'ABERTA' },
        select: { id: true },
      });
      const last = await tx.saleReturn.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      for (const l of lines) {
        await tx.stockItem.updateMany({
          where: { productId: l.original.productId },
          data: { quantity: { increment: l.qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: l.original.productId,
            type: 'DEVOLUCAO',
            quantity: l.qty,
            reason: `Devolucao #${number} da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      const created = await tx.saleReturn.create({
        data: {
          number,
          saleId: sale.id,
          operatorId,
          cashSessionId: openSession?.id ?? null,
          reason: dto.reason,
          refundMethod: dto.refundMethod,
          total,
          // Snapshot do que saiu da gaveta: e o que o cancelamento posterior
          // precisa saber para nao estornar duas vezes nem reter dinheiro.
          cashRefunded:
            dto.refundMethod === 'DINHEIRO' ? reembolsavelEmDinheiro : D(0),
          items: {
            create: lines.map((l) => ({
              saleItemId: l.original.id,
              productId: l.original.productId,
              description: l.original.description,
              quantity: l.qty,
              unitPrice: l.unitPrice,
              total: l.total,
            })),
          },
        },
        include: { items: true },
      });

      if (
        openSession &&
        dto.refundMethod === 'DINHEIRO' &&
        reembolsavelEmDinheiro.gt(0)
      ) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            type: 'SANGRIA',
            amount: reembolsavelEmDinheiro,
            reason: `Devolucao #${number} da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // A fatia do crediario abate o que a venda ainda deve, comecando pelo
      // vencimento mais distante. O que nao encontrar parcela em aberto (porque
      // o cliente ja pagou) volta como credito a resolver a mao.
      let crediarioSemTitulo = D(0);
      if (fatiaCrediario.gt(0)) {
        const abatido = await this.receivables.reduceForSale(
          tx,
          sale.id,
          fatiaCrediario,
          `Devolucao #${number} da venda #${sale.number}`,
        );
        crediarioSemTitulo = abatido.remaining;
      }

      // A fatia da fidelidade volta para o cliente, e o cashback proporcional
      // ao que foi devolvido sai.
      if (sale.customerId && (fatiaFidelidade.gt(0) || fracao.gt(0))) {
        const acumulado = await this.loyalty.accruedForSale(tx, sale.id);
        const clawback = acumulado
          .mul(fracao)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
        if (fatiaFidelidade.gt(0) || clawback.gt(0)) {
          await this.loyalty.refundForReturn(tx, {
            customerId: sale.customerId,
            saleId: sale.id,
            redeemed: fatiaFidelidade,
            clawback,
            userId: operatorId,
            reason: `Devolucao #${number} da venda #${sale.number}`,
          });
        }
      }

      // NFC-e: a devolucao parcial exige NF-e de devolucao (modelo 55), fora do
      // escopo do provedor atual. O documento da venda original nao muda.
      return {
        saleReturn: created,
        saleNumber: sale.number,
        rateio: {
          dinheiro: reembolsavelEmDinheiro,
          crediario: fatiaCrediario,
          fidelidade: fatiaFidelidade,
          crediarioSemTitulo,
        },
      };
    });

    await this.authorization.record({
      action: 'sales.return',
      permissionKey: 'sales.return',
      actorId: operatorId,
      approverId,
      targetType: 'SaleReturn',
      targetId: saleReturn.id,
      detail: {
        number: saleReturn.number,
        saleNumber,
        total: String(saleReturn.total),
        // O rateio explica por que a gaveta pode ter saido menos que o total.
        emDinheiro: String(rateio.dinheiro),
        abatidoNoCrediario: String(rateio.crediario),
        devolvidoEmSaldo: String(rateio.fidelidade),
      },
    });

    // Crediario devolvido sem parcela em aberto para abater: o cliente ja pagou
    // aquela fatia e tem credito a receber. Nao ha como resolver sozinho — a
    // trilha e o unico lugar onde isso aparece para o gerente.
    if (rateio.crediarioSemTitulo.gt(0)) {
      await this.authorization.record({
        action: 'sales.return.creditPending',
        actorId: operatorId,
        approverId,
        targetType: 'SaleReturn',
        targetId: saleReturn.id,
        detail: {
          saleNumber,
          valor: String(rateio.crediarioSemTitulo),
        },
      });
    }

    this.metrics.increment('vendas.devolucoes');
    return saleReturn;
  }
}
