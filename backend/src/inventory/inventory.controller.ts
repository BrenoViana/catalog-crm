import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { InventoryService } from './inventory.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';
import { RequirePermissions } from '../common/permissions.decorator';
import {
  UsedAuthorizationGrant,
  type UsedGrant,
} from '../common/grant.decorator';
import { AuthorizationService } from '../access/authorization.service';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly authorization: AuthorizationService,
  ) {}

  @RequirePermissions('inventory.view')
  @Get()
  list() {
    return this.inventoryService.list();
  }

  @RequirePermissions('inventory.view')
  @Get('low-stock')
  lowStock() {
    return this.inventoryService.lowStock();
  }

  @RequirePermissions('inventory.view')
  @Get('movements')
  movements(@Query('productId') productId?: string) {
    return this.inventoryService.movements(productId);
  }

  /**
   * Entrada, ajuste e perda de estoque. Mercadoria e dinheiro parado: um ajuste
   * de perda e a forma mais simples de fazer produto sumir sem venda. Vai para
   * a trilha com produto, tipo, quantidade e motivo — ultimo buraco do SEC-009.
   */
  @RequirePermissions('inventory.adjust')
  @Post('adjust')
  async adjust(
    @Body() dto: StockAdjustDto,
    @CurrentUser('userId') userId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const result = await this.inventoryService.adjust(dto, userId);
    await this.authorization.record({
      action: 'inventory.adjust',
      actorId: userId,
      approverId: grant?.approverId,
      permissionKey: grant?.permission,
      targetType: 'Product',
      targetId: dto.productId,
      detail: {
        tipo: dto.type,
        quantidade: String(dto.quantity),
        motivo: dto.reason ?? null,
      },
    });
    return result;
  }
}
