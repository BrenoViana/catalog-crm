import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class OpenCashDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CloseCashDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CashMovementDto {
  @IsIn(['SANGRIA', 'SUPRIMENTO'])
  type: 'SANGRIA' | 'SUPRIMENTO';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
