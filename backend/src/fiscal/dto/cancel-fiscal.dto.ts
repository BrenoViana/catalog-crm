import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelFiscalDto {
  /** Justificativa do cancelamento — a NFC-e exige de 15 a 255 caracteres. */
  @IsString()
  @MinLength(15, { message: 'A justificativa deve ter ao menos 15 caracteres.' })
  @MaxLength(255)
  reason: string;
}
