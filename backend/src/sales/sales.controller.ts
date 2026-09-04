import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.salesService.list({ status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthUser) {
    return this.salesService.create(dto, user.userId, user.role);
  }

  @Roles(Role.GERENTE)
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelSaleDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.salesService.cancel(id, dto, userId);
  }

  @Get(':id/returns')
  listReturns(@Param('id') id: string) {
    return this.salesService.listReturns(id);
  }

  @Post(':id/returns')
  createReturn(
    @Param('id') id: string,
    @Body() dto: CreateReturnDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.salesService.createReturn(id, dto, userId);
  }
}
