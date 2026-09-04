import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class OpenCashDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Terminal/caixa (por dispositivo) em que o turno esta sendo aberto. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  terminal?: string;
}

export class CloseCashDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedAmount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CashMovementDto {
  @IsIn(['SANGRIA', 'SUPRIMENTO'])
  type: 'SANGRIA' | 'SUPRIMENTO';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  // Justificativa obrigatoria — trilha de auditoria de retirada/reforco de caixa.
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}
