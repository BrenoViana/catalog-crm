import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
