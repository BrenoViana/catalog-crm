import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsImportService],
  exports: [ProductsService],
})
export class ProductsModule {}
