import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaymentMethodDto } from './create-sale.dto';

export class ReturnItemInput {
  @IsUUID()
  saleItemId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}

export class CreateReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemInput)
  items: ReturnItemInput[];

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  reason: string;

  /** Como o valor foi devolvido ao cliente (dinheiro sai do caixa como sangria). */
  @IsEnum(PaymentMethodDto)
  refundMethod: PaymentMethodDto;
}
