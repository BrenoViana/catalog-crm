import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export enum SaleStatusDto {
  PAID = 'PAID',
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
}

export class CreateSaleDto {
  @IsString()
  @IsNotEmpty()
  opportunityId: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsEnum(SaleStatusDto)
  status?: SaleStatusDto;
}
