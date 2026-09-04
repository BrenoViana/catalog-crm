import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { CancelFiscalDto } from './dto/cancel-fiscal.dto';
import { FiscalService } from './fiscal.service';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('documents')
  list(@Query('status') status?: string) {
    return this.fiscal.list(status);
  }

  @Get('documents/:id')
  findOne(@Param('id') id: string) {
    return this.fiscal.findOne(id);
  }

  /** Reemite manualmente um documento preso em PENDENTE/REJEITADA. */
  @Roles(Role.GERENTE)
  @Post('documents/:id/emit')
  emit(@Param('id') id: string) {
    return this.fiscal.emit(id);
  }

  @Roles(Role.GERENTE)
  @Post('documents/:id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelFiscalDto) {
    return this.fiscal.cancelDocument(id, dto.reason);
  }

  /** Reprocessa em lote os documentos pendentes/rejeitados. */
  @Roles(Role.GERENTE)
  @Post('process-pending')
  processPending() {
    return this.fiscal.processPending();
  }
}
