import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/** Movimentacao manual de estoque (entrada, ajuste, perda). */
export class StockAdjustDto {
  @IsUUID()
  productId: string;

  @IsIn(['ENTRADA', 'AJUSTE', 'PERDA'])
  type: 'ENTRADA' | 'AJUSTE' | 'PERDA';

  /**
   * Quantidade movimentada. Para ENTRADA soma ao saldo; para PERDA subtrai;
   * para AJUSTE define o novo saldo absoluto.
   */
  // Sem piso, `PERDA` com quantidade negativa SOMAVA ao estoque e entrava na
  // trilha como perda — entrada de mercadoria disfarcada de erro de digitacao.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  // O corpo aceita 8 MB e o motivo vai inteiro para o detail do AuditLog.
  @MaxLength(300)
  reason?: string;
}
