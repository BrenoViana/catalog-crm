import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import {
  CreateTerminalDto,
  SetTerminalActiveDto,
  UpdateTerminalDto,
} from './dto/terminal.dto';
import { TerminalsService } from './terminals.service';

/**
 * Cadastro de terminais. A identidade do terminal e nucleo (nunca depende de
 * licenca); ler a lista basta ter `sales.view` — o PDV precisa dela no seletor
 * de caixa —, mas mexer no cadastro e nas faixas de contingencia exige
 * `terminals.manage`.
 */
@Controller('terminals')
export class TerminalsController {
  constructor(private readonly terminals: TerminalsService) {}

  @RequirePermissions('sales.view')
  @Get()
  list() {
    return this.terminals.list();
  }

  @RequirePermissions('sales.view')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.terminals.findOne(id);
  }

  @RequirePermissions('terminals.manage')
  @Post()
  create(
    @Body() dto: CreateTerminalDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.terminals.create(dto, userId);
  }

  @RequirePermissions('terminals.manage')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerminalDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.terminals.update(id, dto, userId);
  }

  @RequirePermissions('terminals.manage')
  @Post(':id/active')
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTerminalActiveDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.terminals.setActive(id, dto.active, userId);
  }
}
