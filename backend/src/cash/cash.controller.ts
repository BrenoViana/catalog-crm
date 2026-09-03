import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { CashService } from './cash.service';
import { CashMovementDto, CloseCashDto, OpenCashDto } from './dto/cash.dto';

@Controller('cash')
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('current')
  current(@CurrentUser('userId') userId: string) {
    return this.cashService.current(userId);
  }

  @Get('history')
  history(@CurrentUser('userId') userId: string) {
    return this.cashService.history(userId);
  }

  @Post('open')
  open(@Body() dto: OpenCashDto, @CurrentUser('userId') userId: string) {
    return this.cashService.open(dto, userId);
  }

  @Post('movement')
  movement(@Body() dto: CashMovementDto, @CurrentUser('userId') userId: string) {
    return this.cashService.addMovement(dto, userId);
  }

  @Post('close')
  close(@Body() dto: CloseCashDto, @CurrentUser('userId') userId: string) {
    return this.cashService.close(dto, userId);
  }
}
