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
import { UsedAuthorizationGrant, type UsedGrant } from '../common/grant.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { CoreRoute, RequireModule } from '../license/module.guard';
import { CashflowService } from './cashflow.service';
import { CostCentersService } from './cost-centers.service';
import { DailyClosingService } from './daily-closing.service';
import { FinanceDashboardService } from './dashboard.service';
import { FinancialAccountsService } from './financial-accounts.service';
import { FinancialCategoriesService } from './financial-categories.service';
import {
  CancelTitleDto,
  CategoryTreeQueryDto,
  CloseDayDto,
  CostCenterDto,
  CreateFinancialAccountDto,
  CreateFinancialCategoryDto,
  CreatePayableDto,
  CreateReceivableDto,
  CreateTransferDto,
  DayQueryDto,
  ListTitlesQueryDto,
  PeriodQueryDto,
  ReopenDayDto,
  SetCreditLimitDto,
  SettleTitleDto,
  SupplierDto,
  UpdateFinancialAccountDto,
  UpdateFinancialCategoryDto,
} from './dto/finance.dto';
import { PayablesService } from './payables.service';
import { ReceivablesService } from './receivables.service';
import { TransfersService } from './transfers.service';

/** de/para dos campos que mudaram entre `before` e `after`, para a trilha. */
function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: string[],
): Record<string, { de: string; para: string }> {
  const out: Record<string, { de: string; para: string }> = {};
  for (const k of keys) {
    if (String(before[k] ?? '') !== String(after[k] ?? '')) {
      out[k] = { de: String(before[k] ?? ''), para: String(after[k] ?? '') };
    }
  }
  return out;
}

/**
 * Financeiro. Todo o modulo esta atras do gate `financeiro`: o caixa continua
 * funcionando sem ele, que e a regra do licenciamento.
 *
 * Toda operacao que mexe em dinheiro — baixa, cancelamento de titulo, limite de
 * crediario, transferencia entre contas — entra na trilha de auditoria, e
 * quando a rota so passou por um vale de supervisor a trilha grava `approverId`
 * e a permissao do vale (SEC-099). Baixa de titulo e especialmente sensivel: e
 * a operacao que permite a alguem receber em maos e dar o titulo por pago.
 */
@RequireModule('financeiro')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
    private readonly cashflow: CashflowService,
    private readonly dailyClosing: DailyClosingService,
    private readonly accounts: FinancialAccountsService,
    private readonly categories: FinancialCategoriesService,
    private readonly costCenters: CostCentersService,
    private readonly transfers: TransfersService,
    private readonly dashboard: FinanceDashboardService,
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

  /** Dashboard financeiro: saldos por conta, vencimentos, projecao, inadimplencia. */
  @RequirePermissions('finance.view')
  @Get('dashboard')
  financeDashboard() {
    return this.dashboard.overview();
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
  async closeDay(
    @Body() dto: CloseDayDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const closing = await this.dailyClosing.close(dto, actorId);
    await this.authorization.record({
      action: 'finance.dailyClosing.close',
      permissionKey: grant?.permission ?? 'finance.dailyClosing.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const closing = await this.dailyClosing.reopen(date, dto, actorId);
    await this.authorization.record({
      action: 'finance.dailyClosing.reopen',
      permissionKey: grant?.permission ?? 'finance.dailyClosing.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    if (dto.financialCategoryId) {
      await this.categories.assertUsable(dto.financialCategoryId, 'RECEITA');
    }
    if (dto.costCenterId) await this.costCenters.assertUsable(dto.costCenterId);
    const rows = await this.receivables.createManual(dto);
    await this.authorization.record({
      action: 'finance.receivable.create',
      permissionKey: grant?.permission ?? 'finance.receivables.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    if (dto.accountId) await this.accounts.assertUsable(dto.accountId);
    const title = await this.receivables.settle(id, dto, actorId);
    await this.authorization.record({
      action: 'finance.receivable.settle',
      permissionKey: grant?.permission ?? 'finance.receivables.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'Receivable',
      targetId: id,
      detail: {
        titulo: title.number,
        cliente: title.customer.name,
        valor: String(dto.amount),
        forma: dto.method,
        conta: dto.accountId ?? null,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const title = await this.receivables.cancel(id, dto);
    await this.authorization.record({
      action: 'finance.receivable.cancel',
      permissionKey: grant?.permission ?? 'finance.receivables.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const before = await this.receivables.creditStatus(customerId);
    const after = await this.receivables.setCreditLimit(customerId, dto.creditLimit);
    await this.authorization.record({
      action: 'finance.creditLimit.update',
      permissionKey: grant?.permission ?? 'finance.receivables.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    if (dto.financialCategoryId) {
      await this.categories.assertUsable(dto.financialCategoryId, 'DESPESA');
    }
    if (dto.costCenterId) await this.costCenters.assertUsable(dto.costCenterId);
    const created = await this.payables.create(dto, actorId);
    await this.authorization.record({
      action: 'finance.payable.create',
      permissionKey: grant?.permission ?? 'finance.payables.manage',
      actorId,
      approverId: grant?.approverId,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    if (dto.accountId) await this.accounts.assertUsable(dto.accountId);
    const title = await this.payables.settle(id, dto, actorId);
    await this.authorization.record({
      action: 'finance.payable.settle',
      permissionKey: grant?.permission ?? 'finance.payables.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'Payable',
      targetId: id,
      detail: {
        despesa: title.number,
        valor: String(dto.amount),
        forma: dto.method,
        conta: dto.accountId ?? null,
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
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const title = await this.payables.cancel(id, dto);
    await this.authorization.record({
      action: 'finance.payable.cancel',
      permissionKey: grant?.permission ?? 'finance.payables.manage',
      actorId,
      approverId: grant?.approverId,
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
  async createSupplier(
    @Body() dto: SupplierDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const supplier = await this.payables.createSupplier(dto);
    await this.authorization.record({
      action: 'finance.supplier.create',
      permissionKey: grant?.permission ?? 'finance.payables.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'Supplier',
      targetId: supplier.id,
      detail: { nome: supplier.name },
    });
    return supplier;
  }

  @RequirePermissions('finance.payables.manage')
  @Patch('suppliers/:id')
  async updateSupplier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupplierDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const supplier = await this.payables.updateSupplier(id, dto);
    await this.authorization.record({
      action: 'finance.supplier.update',
      permissionKey: grant?.permission ?? 'finance.payables.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'Supplier',
      targetId: id,
      detail: { campos: Object.keys(dto).sort() },
    });
    return supplier;
  }

  // ---------------------------------------------------- Contas financeiras

  @RequirePermissions('finance.view')
  @Get('accounts')
  listAccounts(@Query('includeArchived') includeArchived?: string) {
    return this.accounts.list(includeArchived === 'true');
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('accounts')
  async createAccount(
    @Body() dto: CreateFinancialAccountDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const acc = await this.accounts.create(dto);
    await this.authorization.record({
      action: 'finance.account.create',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialAccount',
      targetId: acc.id,
      detail: { nome: acc.name, tipo: acc.type, abertura: String(acc.openingBalance) },
    });
    return acc;
  }

  @RequirePermissions('finance.accounts.manage')
  @Patch('accounts/:id')
  async updateAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialAccountDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const { before, after } = await this.accounts.update(id, dto);
    // de/para com valor: `openingBalance` e o piso do saldo derivado, gravar so
    // o nome do campo apagaria o rastro da posicao de caixa (SEC-098).
    await this.authorization.record({
      action: 'finance.account.update',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialAccount',
      targetId: id,
      detail: changed(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['name', 'type', 'bankBranch', 'bankNumber', 'openingBalance', 'openingDate'],
      ),
    });
    return after;
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('accounts/:id/archive')
  async archiveAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('undo') undo: string | undefined,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const acc =
      undo === 'true'
        ? await this.accounts.unarchive(id)
        : await this.accounts.archive(id);
    await this.authorization.record({
      action: undo === 'true' ? 'finance.account.unarchive' : 'finance.account.archive',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialAccount',
      targetId: id,
      detail: { nome: acc.name, aberturaNoMomento: String(acc.openingBalance) },
    });
    return acc;
  }

  // ------------------------------------------------------ Plano de contas

  @RequirePermissions('finance.view')
  @Get('categories')
  listCategories(@Query() query: CategoryTreeQueryDto) {
    return this.categories.tree(query.kind);
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('categories')
  async createCategory(
    @Body() dto: CreateFinancialCategoryDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const cat = await this.categories.create(dto);
    await this.authorization.record({
      action: 'finance.category.create',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialCategory',
      targetId: cat.id,
      detail: { nome: cat.name, natureza: cat.kind, pai: cat.parentId },
    });
    return cat;
  }

  @RequirePermissions('finance.accounts.manage')
  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialCategoryDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const { before, after } = await this.categories.update(id, dto);
    await this.authorization.record({
      action: 'finance.category.update',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialCategory',
      targetId: id,
      detail: changed(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['name', 'code'],
      ),
    });
    return after;
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('categories/:id/archive')
  async archiveCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const cat = await this.categories.archive(id);
    await this.authorization.record({
      action: 'finance.category.archive',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'FinancialCategory',
      targetId: id,
      detail: { nome: cat.name },
    });
    return cat;
  }

  // ------------------------------------------------------ Centros de custo

  @RequirePermissions('finance.view')
  @Get('cost-centers')
  listCostCenters(@Query('includeArchived') includeArchived?: string) {
    return this.costCenters.list(includeArchived === 'true');
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('cost-centers')
  async createCostCenter(
    @Body() dto: CostCenterDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const cc = await this.costCenters.create(dto);
    await this.authorization.record({
      action: 'finance.costCenter.create',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'CostCenter',
      targetId: cc.id,
      detail: { nome: cc.name },
    });
    return cc;
  }

  @RequirePermissions('finance.accounts.manage')
  @Patch('cost-centers/:id')
  async updateCostCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CostCenterDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const { before, after } = await this.costCenters.update(id, dto);
    await this.authorization.record({
      action: 'finance.costCenter.update',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'CostCenter',
      targetId: id,
      detail: changed(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        ['name', 'code'],
      ),
    });
    return after;
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('cost-centers/:id/archive')
  async archiveCostCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const cc = await this.costCenters.archive(id);
    await this.authorization.record({
      action: 'finance.costCenter.archive',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'CostCenter',
      targetId: id,
      detail: { nome: cc.name },
    });
    return cc;
  }

  // ------------------------------------------------------- Transferencias

  @RequirePermissions('finance.view')
  @Get('transfers')
  listTransfers(@Query() query: PeriodQueryDto) {
    return this.transfers.list(query);
  }

  @RequirePermissions('finance.accounts.manage')
  @Post('transfers')
  async createTransfer(
    @Body() dto: CreateTransferDto,
    @CurrentUser('userId') actorId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const t = await this.transfers.create(dto, actorId);
    await this.authorization.record({
      action: 'finance.transfer.create',
      permissionKey: grant?.permission ?? 'finance.accounts.manage',
      actorId,
      approverId: grant?.approverId,
      targetType: 'AccountTransfer',
      targetId: t.id,
      detail: {
        de: t.fromAccount.name,
        para: t.toAccount.name,
        valor: String(t.amount),
      },
    });
    return t;
  }
}
