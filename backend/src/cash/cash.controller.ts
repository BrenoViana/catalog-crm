import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { CashService } from './cash.service';
import { CashMovementDto, CloseCashDto, OpenCashDto } from './dto/cash.dto';

@Controller('cash')
export class CashController {
  constructor(private readonly cashService: CashService) {}

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

  @RequirePermissions('cash.operate')
  @Post('open')
  open(@Body() dto: OpenCashDto, @CurrentUser('userId') userId: string) {
    return this.cashService.open(dto, userId);
  }

  @RequirePermissions('cash.movement')
  @Post('movement')
  movement(@Body() dto: CashMovementDto, @CurrentUser('userId') userId: string) {
    return this.cashService.addMovement(dto, userId);
  }

  @RequirePermissions('cash.operate')
  @Post('close')
  close(@Body() dto: CloseCashDto, @CurrentUser('userId') userId: string) {
    return this.cashService.close(dto, userId);
  }
}
