import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import {
  UsedAuthorizationGrant,
  type UsedGrant,
} from '../common/grant.decorator';
import { AuthorizationService } from '../access/authorization.service';
import { CashService } from './cash.service';
import {
  CashMovementDto,
  CloseCashDto,
  ConsolidatedQueryDto,
  OpenCashDto,
} from './dto/cash.dto';

@Controller('cash')
export class CashController {
  constructor(
    private readonly cashService: CashService,
    private readonly authorization: AuthorizationService,
  ) {}

  @RequirePermissions('cash.operate')
  @Get('current')
  current(@CurrentUser('userId') userId: string) {
    return this.cashService.current(userId);
  }

  @RequirePermissions('cash.report')
  @Get('history')
  history(@CurrentUser('userId') userId: string) {
    return this.cashService.history(userId);
  }

  /** Leitura X: resumo do turno aberto do operador. */
  @RequirePermissions('cash.report')
  @Get('report')
  report(@CurrentUser('userId') userId: string) {
    return this.cashService.report(userId);
  }

  /** Relatorio Z: resumo de um turno especifico (ex.: recem-fechado). */
  @RequirePermissions('cash.report')
  @Get('report/:sessionId')
  reportFor(
    @Param('sessionId') sessionId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.cashService.report(userId, sessionId);
  }

  /**
   * Consolidado multi-caixa do periodo: todos os turnos, de todos os operadores
   * e terminais.
   *
   * Permissao propria (`cash.consolidate`), nao `cash.report`: a leitura X/Z
   * mostra o proprio turno do operador, esta mostra o desempenho e a
   * divergencia de gaveta de TODO MUNDO. Sao decisoes de acesso diferentes.
   */
  @RequirePermissions('cash.consolidate')
  @Get('consolidated')
  consolidated(@Query() query: ConsolidatedQueryDto) {
    return this.cashService.consolidated(query);
  }

  @RequirePermissions('cash.operate')
  @Post('open')
  open(@Body() dto: OpenCashDto, @CurrentUser('userId') userId: string) {
    return this.cashService.open(dto, userId);
  }

  /**
   * Sangria e suprimento sao dinheiro saindo e entrando da gaveta pela mao do
   * operador — o vetor classico de furto de caixa. Vai para a trilha com valor
   * e motivo, e com quem liberou quando passou por vale de supervisor.
   */
  @RequirePermissions('cash.movement')
  @Post('movement')
  async movement(
    @Body() dto: CashMovementDto,
    @CurrentUser('userId') userId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const result = await this.cashService.addMovement(dto, userId);
    await this.authorization.record({
      action: `cash.${String(dto.type).toLowerCase()}`,
      actorId: userId,
      approverId: grant?.approverId,
      permissionKey: grant?.permission,
      targetType: 'CashSession',
      targetId: result?.id ?? null,
      detail: { tipo: dto.type, valor: String(dto.amount), motivo: dto.reason ?? null },
    });
    return result;
  }

  @RequirePermissions('cash.operate')
  @Post('close')
  async close(@Body() dto: CloseCashDto, @CurrentUser('userId') userId: string) {
    const result = await this.cashService.close(dto, userId);
    await this.authorization.record({
      action: 'cash.close',
      actorId: userId,
      targetType: 'CashSession',
      targetId: result?.id ?? null,
      detail: {
        contado: String(result?.closingCountedAmount ?? ''),
        esperado: String(result?.closingExpectedAmount ?? ''),
        // Divergencia de fechamento e o sinal que separa erro de furto.
        diferenca: String(result?.difference ?? ''),
      },
    });
    return result;
  }
}
