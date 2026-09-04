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
import { ImportProductsDto } from './dto/import-products.dto';
import { ProductsImportService } from './products-import.service';
import { RequirePermissions } from '../common/permissions.decorator';

@Controller()
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly importService: ProductsImportService,
  ) {}

  @RequirePermissions('products.view')
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

  @RequirePermissions('products.view')
  @Get('tax-groups')
  taxGroups() {
    return this.productsService.listTaxGroups();
  }

  @RequirePermissions('products.view')
  @Get('products/by-code/:code')
  findByCode(@Param('code') code: string) {
    return this.productsService.findByCode(code);
  }

  @RequirePermissions('products.view')
  @Get('products/:id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @RequirePermissions('products.import')
  @Post('products/import')
  import(@Body() dto: ImportProductsDto) {
    return this.importService.import(dto);
  }

  @RequirePermissions('products.manage')
  @Post('products')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @RequirePermissions('products.manage')
  @Patch('products/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @RequirePermissions('products.manage')
  @Delete('products/:id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
