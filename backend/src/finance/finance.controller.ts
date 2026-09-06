import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthorizationService } from '../access/authorization.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { CoreRoute, RequireModule } from '../license/module.guard';
import { CashflowService } from './cashflow.service';
import { DailyClosingService } from './daily-closing.service';
import {
  CancelTitleDto,
  CloseDayDto,
  CreatePayableDto,
  CreateReceivableDto,
  DayQueryDto,
  ListTitlesQueryDto,
  PeriodQueryDto,
  ReopenDayDto,
  SetCreditLimitDto,
  SettleTitleDto,
  SupplierDto,
} from './dto/finance.dto';
import { PayablesService } from './payables.service';
import { ReceivablesService } from './receivables.service';

/**
 * Financeiro. Todo o modulo esta atras do gate `financeiro`: o caixa continua
 * funcionando sem ele, que e a regra do licenciamento.
 *
 * Toda operacao que mexe em dinheiro — baixa, cancelamento de titulo, limite de
 * crediario — entra na trilha de auditoria. Baixa de titulo e especialmente
 * sensivel: e a operacao que permite a alguem receber em maos e dar o titulo
 * por pago.
 */
@RequireModule('financeiro')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
    private readonly cashflow: CashflowService,
    private readonly dailyClosing: DailyClosingService,
    private readonly authorization: AuthorizationService,
  ) {}

  // ------------------------------------------------------------ Panorama

  @RequirePermissions('finance.view')
  @Get('overview')
  async overview() {
    const [receivables, payables] = await Promise.all([
      this.receivables.summary(),
      this.payables.summary(),
    ]);
    return { receivables, payables };
  }

  @RequirePermissions('finance.view')
  @Get('cashflow')
  cashflowReport(@Query() query: PeriodQueryDto) {
    return this.cashflow.report(query);
  }

  // --------------------------------------------------- Fechamento do dia

  /** Retrato do dia: o fechamento gravado (se houver) e a previa de agora. */
  @RequirePermissions('finance.view')
  @Get('daily-closing')
  dayStatus(@Query() query: DayQueryDto, @CurrentUser('userId') viewerId: string) {
    return this.dailyClosing.status(viewerId, query.date);
  }

  @RequirePermissions('finance.view')
  @Get('daily-closing/history')
  dayHistory() {
    return this.dailyClosing.list();
  }

  /**
   * Fecha o dia. E a operacao que transforma a soma do sistema em numero
   * conferido, entao vai para a trilha com o total, a divergencia de gaveta e
   * quantos turnos entraram.
   */
  @RequirePermissions('finance.dailyClosing.manage')
  @Post('daily-closing')
  async closeDay(@Body() dto: CloseDayDto, @CurrentUser('userId') actorId: string) {
    const closing = await this.dailyClosing.close(dto, actorId);
    await this.authorization.record({
      action: 'finance.dailyClosing.close',
      permissionKey: 'finance.dailyClosing.manage',
      actorId,
      targetType: 'DailyClosing',
      targetId: closing.id,
      detail: {
        dia: closing.date,
        turnos: closing.sessionCount,
        vendas: String(closing.totalSales),
        diferencaCaixa: String(closing.cashDifference),
        versao: closing.version,
      },
    });
    return closing;
  }

  /**
   * Reabre um dia fechado. Sempre auditado: reabrir e o unico caminho para
   * mexer num numero ja conferido, e por isso mesmo e o caminho que precisa
   * deixar rastro de quem, quando e por que.
   *
   * Unica rota do modulo FORA do gate de licenca (SEC-073): o dia fechado
   * bloqueia a abertura de caixa, que e nucleo. Se a reabertura dependesse da
   * licenca do modulo `financeiro`, uma licenca vencida deixaria o balcao sem
   * abrir caixa ate a virada do dia — exatamente o que a regra "o nucleo nunca
   * e bloqueado" existe para impedir.
   */
  @CoreRoute()
  @RequirePermissions('finance.dailyClosing.manage')
  @Post('daily-closing/:date/reopen')
  async reopenDay(
    @Param('date') date: string,
    @Body() dto: ReopenDayDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const closing = await this.dailyClosing.reopen(date, dto, actorId);
    await this.authorization.record({
      action: 'finance.dailyClosing.reopen',
      permissionKey: 'finance.dailyClosing.manage',
      actorId,
      targetType: 'DailyClosing',
      targetId: closing.id,
      detail: {
        dia: closing.date,
        motivo: dto.reason,
        vendasNoFechamento: String(closing.totalSales),
      },
    });
    return closing;
  }

  // ----------------------------------------------------------- A receber

  @RequirePermissions('finance.view')
  @Get('receivables')
  listReceivables(@Query() query: ListTitlesQueryDto) {
    return this.receivables.list(query);
  }

  @RequirePermissions('finance.view')
  @Get('receivables/credit/:customerId')
  creditStatus(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.receivables.creditStatus(customerId);
  }

  @RequirePermissions('finance.receivables.manage')
  @Post('receivables')
  async createReceivable(
    @Body() dto: CreateReceivableDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const rows = await this.receivables.createManual(dto);
    await this.authorization.record({
      action: 'finance.receivable.create',
      permissionKey: 'finance.receivables.manage',
      actorId,
      targetType: 'Customer',
      targetId: dto.customerId,
      detail: {
        descricao: dto.description,
        valor: String(dto.amount),
        parcelas: rows.length,
      },
    });
    return rows;
  }

  @RequirePermissions('finance.receivables.manage')
  @Post('receivables/:id/settle')
  async settleReceivable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleTitleDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const title = await this.receivables.settle(id, dto, actorId);
    await this.authorization.record({
      action: 'finance.receivable.settle',
      permissionKey: 'finance.receivables.manage',
      actorId,
      targetType: 'Receivable',
      targetId: id,
      detail: {
        titulo: title.number,
        cliente: title.customer.name,
        valor: String(dto.amount),
        forma: dto.method,
        situacao: title.status,
      },
    });
    return title;
  }

  @RequirePermissions('finance.receivables.manage')
  @Post('receivables/:id/cancel')
  async cancelReceivable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTitleDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const title = await this.receivables.cancel(id, dto);
    await this.authorization.record({
      action: 'finance.receivable.cancel',
      permissionKey: 'finance.receivables.manage',
      actorId,
      targetType: 'Receivable',
      targetId: id,
      detail: {
        titulo: title.number,
        valor: String(title.amount),
        motivo: dto.reason,
      },
    });
    return title;
  }

  /** Limite de crediario: e uma decisao de credito, vai para a trilha. */
  @RequirePermissions('finance.receivables.manage')
  @Patch('receivables/credit/:customerId')
  async setCreditLimit(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: SetCreditLimitDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const before = await this.receivables.creditStatus(customerId);
    const after = await this.receivables.setCreditLimit(customerId, dto.creditLimit);
    await this.authorization.record({
      action: 'finance.creditLimit.update',
      permissionKey: 'finance.receivables.manage',
      actorId,
      targetType: 'Customer',
      targetId: customerId,
      detail: { de: String(before.limit), para: String(after.limit) },
    });
    return after;
  }

  // ------------------------------------------------------------- A pagar

  @RequirePermissions('finance.view')
  @Get('payables')
  listPayables(@Query() query: ListTitlesQueryDto) {
    return this.payables.list(query);
  }

  @RequirePermissions('finance.view')
  @Get('payables/categories')
  payableCategories() {
    return this.payables.categories();
  }

  @RequirePermissions('finance.payables.manage')
  @Post('payables')
  async createPayable(
    @Body() dto: CreatePayableDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const created = await this.payables.create(dto, actorId);
    await this.authorization.record({
      action: 'finance.payable.create',
      permissionKey: 'finance.payables.manage',
      actorId,
      targetType: 'Payable',
      targetId: created.id,
      detail: {
        despesa: created.number,
        descricao: created.description,
        valor: String(created.amount),
        recorrencia: created.recurrence,
      },
    });
    return created;
  }

  @RequirePermissions('finance.payables.manage')
  @Post('payables/:id/settle')
  async settlePayable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleTitleDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const title = await this.payables.settle(id, dto, actorId);
    await this.authorization.record({
      action: 'finance.payable.settle',
      permissionKey: 'finance.payables.manage',
      actorId,
      targetType: 'Payable',
      targetId: id,
      detail: {
        despesa: title.number,
        valor: String(dto.amount),
        forma: dto.method,
        situacao: title.status,
        proxima: title.next ? title.next.number : null,
      },
    });
    return title;
  }

  @RequirePermissions('finance.payables.manage')
  @Post('payables/:id/cancel')
  async cancelPayable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTitleDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const title = await this.payables.cancel(id, dto);
    await this.authorization.record({
      action: 'finance.payable.cancel',
      permissionKey: 'finance.payables.manage',
      actorId,
      targetType: 'Payable',
      targetId: id,
      detail: {
        despesa: title.number,
        valor: String(title.amount),
        motivo: dto.reason,
      },
    });
    return title;
  }

  // -------------------------------------------------------- Fornecedores

  @RequirePermissions('finance.view')
  @Get('suppliers')
  listSuppliers(@Query('search') search?: string) {
    return this.payables.listSuppliers(search);
  }

  @RequirePermissions('finance.payables.manage')
  @Post('suppliers')
  createSupplier(@Body() dto: SupplierDto) {
    return this.payables.createSupplier(dto);
  }

  @RequirePermissions('finance.payables.manage')
  @Patch('suppliers/:id')
  updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupplierDto,
  ) {
    return this.payables.updateSupplier(id, dto);
  }
}
