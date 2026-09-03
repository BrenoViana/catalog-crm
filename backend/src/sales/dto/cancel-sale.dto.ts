import { IsNotEmpty, IsString } from 'class-validator';

export class CancelSaleDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
