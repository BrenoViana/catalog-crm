import { Module } from '@nestjs/common';
import { FiscalModule } from '../fiscal/fiscal.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [FiscalModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
