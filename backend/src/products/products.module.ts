import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsImportService } from './products-import.service';
import { ProductImagesController } from './product-images.controller';
import { ProductImagesService } from './product-images.service';

@Module({
  controllers: [ProductsController, ProductImagesController],
  providers: [ProductsService, ProductsImportService, ProductImagesService],
  exports: [ProductsService],
})
export class ProductsModule {}
