import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { SellersService } from './sellers.service';
import { CreateSellerDto } from './dto/create-seller.dto';

@UseGuards(JwtAuthGuard)
@Controller('sellers')
export class SellersController {
  constructor(private readonly sellersService: SellersService) {}

  @Get()
  findAll() {
    return this.sellersService.findAll();
  }

  @Post()
  create(@Body() dto: CreateSellerDto) {
    return this.sellersService.create(dto);
  }
}
