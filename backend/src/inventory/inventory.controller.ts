import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { InventoryService } from './inventory.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';
import { RequirePermissions } from '../common/permissions.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

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

  @RequirePermissions('inventory.adjust')
  @Post('adjust')
  adjust(@Body() dto: StockAdjustDto, @CurrentUser('userId') userId: string) {
    return this.inventoryService.adjust(dto, userId);
  }
}
