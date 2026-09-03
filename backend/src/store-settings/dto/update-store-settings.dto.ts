import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateStoreSettingsDto {
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() tradeName?: string;
  @IsOptional() @IsString() cnpj?: string;
  @IsOptional() @IsString() ie?: string;
  @IsOptional() @IsString() im?: string;

  @IsOptional()
  @IsIn(['SIMPLES_NACIONAL', 'SIMPLES_EXCESSO', 'REGIME_NORMAL'])
  taxRegime?: 'SIMPLES_NACIONAL' | 'SIMPLES_EXCESSO' | 'REGIME_NORMAL';

  @IsOptional() @IsString() addressStreet?: string;
  @IsOptional() @IsString() addressNumber?: string;
  @IsOptional() @IsString() addressComplement?: string;
  @IsOptional() @IsString() addressDistrict?: string;
  @IsOptional() @IsString() addressCity?: string;
  @IsOptional() @IsString() addressState?: string;
  @IsOptional() @IsString() addressZip?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;

  @IsOptional() @IsString() nfceEnvironment?: string;
  @IsOptional() @IsString() nfceCscId?: string;
  @IsOptional() @IsString() nfceCsc?: string;
  @IsOptional() @IsString() fiscalProvider?: string;
  @IsOptional() @IsString() fiscalProviderToken?: string;
}
