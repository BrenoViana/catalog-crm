import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryDto } from './dto/category.dto';
import { RequirePermissions } from '../common/permissions.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @RequirePermissions('products.view')
  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @RequirePermissions('categories.manage')
  @Post()
  create(@Body() dto: CategoryDto) {
    return this.categoriesService.create(dto);
  }

  @RequirePermissions('categories.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @RequirePermissions('categories.manage')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
