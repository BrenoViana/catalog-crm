import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTerminalDto {
  /**
   * Codigo curto e estavel do dispositivo. So maiuscula, digito e hifen — e a
   * identidade que a venda offline carrega e nao pode depender de acento nem
   * de espaco.
   */
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,39}$/, {
    message:
      'O codigo do terminal deve ter de 2 a 40 caracteres, apenas letras maiusculas, digitos e hifen.',
  })
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  /** Serie de NFC-e de contingencia reservada a este terminal. */
  @IsOptional()
  @IsInt()
  @Min(1)
  contingencySeries?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  contingencyRangeStart?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  contingencyRangeEnd?: number;
}

export class UpdateTerminalDto extends PartialType(CreateTerminalDto) {}

export class SetTerminalActiveDto {
  @IsBoolean()
  active: boolean;
}
