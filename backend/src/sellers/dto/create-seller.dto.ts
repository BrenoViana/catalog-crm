import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSellerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsNumber()
  salesTarget?: number;

  @IsOptional()
  @IsNumber()
  commissionRate?: number;
}
