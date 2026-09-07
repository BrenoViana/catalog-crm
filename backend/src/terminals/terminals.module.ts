import { Module } from '@nestjs/common';
import { TerminalsController } from './terminals.controller';
import { TerminalsService } from './terminals.service';

/**
 * Cadastro de terminais/caixas. Exporta o TerminalsService porque Sales e Cash
 * resolvem o terminal (codigo/nome livre -> id) no momento de gravar a venda e
 * a abertura de turno.
 */
@Module({
  controllers: [TerminalsController],
  providers: [TerminalsService],
  exports: [TerminalsService],
})
export class TerminalsModule {}
