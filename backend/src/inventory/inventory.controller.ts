import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { InventoryService } from './inventory.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  list() {
    return this.inventoryService.list();
  }

  @Get('low-stock')
  lowStock() {
    return this.inventoryService.lowStock();
  }

  @Get('movements')
  movements(@Query('productId') productId?: string) {
    return this.inventoryService.movements(productId);
  }

  @Roles(Role.GERENTE)
  @Post('adjust')
  adjust(@Body() dto: StockAdjustDto, @CurrentUser('userId') userId: string) {
    return this.inventoryService.adjust(dto, userId);
  }
}
