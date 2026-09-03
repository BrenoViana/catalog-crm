import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { InventoryService } from './inventory.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';

@UseGuards(JwtAuthGuard)
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

  @Post('adjust')
  adjust(@Body() dto: StockAdjustDto, @CurrentUser('userId') userId: string) {
    return this.inventoryService.adjust(dto, userId);
  }
}
