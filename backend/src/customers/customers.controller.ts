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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(
    @CurrentUser('role') role: Role,
    @Query('search') search?: string,
  ) {
    return this.customersService.findAll(search, role);
  }

  @Roles(Role.GERENTE)
  @Get('birthdays')
  birthdays(@Query('month') month?: string) {
    const parsed = Number(month);
    const m =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
        ? parsed
        : new Date().getMonth() + 1;
    return this.customersService.birthdays(m);
  }

  @Roles(Role.GERENTE)
  @Get(':id/profile')
  profile(@Param('id') id: string) {
    return this.customersService.profile(id);
  }

  @Roles(Role.GERENTE)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Roles(Role.GERENTE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Roles(Role.GERENTE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
