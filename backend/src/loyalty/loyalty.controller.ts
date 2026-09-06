import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthorizationService } from '../access/authorization.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { RequireModule } from '../license/module.guard';
import { AdjustLoyaltyDto } from './dto/loyalty.dto';
import { LoyaltyService } from './loyalty.service';

@RequireModule('promocoes')
@Controller('loyalty')
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly authorization: AuthorizationService,
  ) {}

  /**
   * Regras vigentes do programa. O PDV precisa saber se pode oferecer resgate
   * e ate quanto — exigir `settings.manage` para isso deixaria o operador sem
   * a informacao que ele usa no balcao.
   */
  @RequirePermissions('customers.view')
  @Get('config')
  config() {
    return this.loyalty.config();
  }

  @RequirePermissions('customers.view')
  @Get(':customerId')
  statement(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.loyalty.statement(customerId);
  }

  /**
   * Ajuste manual. Cria ou apaga dinheiro do cliente: vai para a trilha
   * sempre, com valor e motivo.
   */
  @RequirePermissions('loyalty.manage')
  @Post(':customerId/adjust')
  async adjust(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AdjustLoyaltyDto,
    @CurrentUser('userId') userId: string,
  ) {
    const result = await this.loyalty.adjust({
      customerId,
      amount: dto.amount,
      reason: dto.reason,
      userId,
    });
    await this.authorization.record({
      action: 'loyalty.adjust',
      permissionKey: 'loyalty.manage',
      actorId: userId,
      targetType: 'Customer',
      targetId: customerId,
      detail: {
        valor: String(dto.amount),
        motivo: dto.reason,
        saldoFinal: String(result.balance),
      },
    });
    return result;
  }
}
