import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import {
  GrantToken,
  UsedAuthorizationGrant,
  type UsedGrant,
} from '../common/grant.decorator';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { RequirePermissions } from '../common/permissions.decorator';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @RequirePermissions('sales.view')
  @Get()
  list(@Query('status') status?: string) {
    return this.salesService.list({ status });
  }

  @RequirePermissions('sales.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesService.findOne(id);
  }

  @RequirePermissions('sales.create')
  @Post()
  create(
    @Body() dto: CreateSaleDto,
    @CurrentUser('userId') userId: string,
    @GrantToken() grant?: string,
  ) {
    return this.salesService.create(dto, userId, grant);
  }

  @RequirePermissions('sales.cancel')
  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelSaleDto,
    @CurrentUser('userId') userId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    return this.salesService.cancel(id, dto, userId, grant?.approverId);
  }

  @RequirePermissions('sales.view')
  @Get(':id/returns')
  listReturns(@Param('id') id: string) {
    return this.salesService.listReturns(id);
  }

  @RequirePermissions('sales.return')
  @Post(':id/returns')
  createReturn(
    @Param('id') id: string,
    @Body() dto: CreateReturnDto,
    @CurrentUser('userId') userId: string,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    return this.salesService.createReturn(id, dto, userId, grant?.approverId);
  }
}
