import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly access: AccessService,
  ) {}

  @RequirePermissions('customers.view')
  @Get()
  async findAll(
    @CurrentUser('userId') userId: string,
    @Query('search') search?: string,
  ) {
    // Ver a base inteira (com CPF/e-mail) exige customers.manage; sem ela,
    // a listagem responde so a busca, com campos reduzidos.
    const fullAccess = await this.access.can(userId, 'customers.manage');
    return this.customersService.findAll(search, fullAccess);
  }

  @RequirePermissions('customers.view')
  @Get('birthdays')
  birthdays(@Query('month') month?: string) {
    const parsed = Number(month);
    const m =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
        ? parsed
        : new Date().getMonth() + 1;
    return this.customersService.birthdays(m);
  }

  @RequirePermissions('customers.view')
  @Get(':id/profile')
  profile(@Param('id') id: string) {
    return this.customersService.profile(id);
  }

  @RequirePermissions('customers.view')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @RequirePermissions('customers.manage')
  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @RequirePermissions('customers.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @RequirePermissions('customers.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
