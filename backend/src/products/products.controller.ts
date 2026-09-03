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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('products')
  findAll(
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('onlyActive') onlyActive?: string,
  ) {
    return this.productsService.findAll({
      search,
      categoryId,
      onlyActive: onlyActive === 'true',
    });
  }

  @Get('tax-groups')
  taxGroups() {
    return this.productsService.listTaxGroups();
  }

  @Get('products/by-code/:code')
  findByCode(@Param('code') code: string) {
    return this.productsService.findByCode(code);
  }

  @Get('products/:id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Roles(Role.GERENTE)
  @Post('products')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Roles(Role.GERENTE)
  @Patch('products/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Roles(Role.GERENTE)
  @Delete('products/:id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
