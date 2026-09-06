import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
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

/**
 * Janela do consolidado multi-caixa. As datas chegam como `AAAA-MM-DD` e sao
 * resolvidas no fuso do servidor — o mesmo criterio do X/Z e dos relatorios,
 * senao o consolidado nao concilia com as leituras que ele soma.
 */
export class ConsolidatedQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from deve estar no formato AAAA-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to deve estar no formato AAAA-MM-DD' })
  to?: string;
}
