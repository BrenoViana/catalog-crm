import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateLicenseDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsOptional()
  @IsString()
  customer?: string;
}
