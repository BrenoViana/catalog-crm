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
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll() {
    return this.categoriesService.findAll();
  }

  @Roles(Role.GERENTE)
  @Post()
  create(@Body() dto: CategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Roles(Role.GERENTE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: CategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Roles(Role.GERENTE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
