import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.decorator';
import { CancelFiscalDto } from './dto/cancel-fiscal.dto';
import { FiscalService } from './fiscal.service';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @RequirePermissions('fiscal.view')
  @Get('documents')
  list(@Query('status') status?: string) {
    return this.fiscal.list(status);
  }

  @RequirePermissions('fiscal.view')
  @Get('documents/:id')
  findOne(@Param('id') id: string) {
    return this.fiscal.findOne(id);
  }

  /** Reemite manualmente um documento preso em PENDENTE/REJEITADA. */
  @RequirePermissions('fiscal.emit')
  @Post('documents/:id/emit')
  emit(@Param('id') id: string) {
    return this.fiscal.emit(id);
  }

  @RequirePermissions('fiscal.cancel')
  @Post('documents/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelFiscalDto) {
    return this.fiscal.cancelDocument(id, dto.reason);
  }

  /** Reprocessa em lote os documentos pendentes/rejeitados. */
  @RequirePermissions('fiscal.emit')
  @Post('process-pending')
  processPending() {
    return this.fiscal.processPending();
  }
}
