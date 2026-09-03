import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Logo aceito como URL https:// ou data URI de imagem embutida.
 * String vazia limpa o logo (normalizada para null no service).
 */
const LOGO_PATTERN =
  /^$|^https:\/\/\S+$|^data:image\/(png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

// ~700 KB de string cobre uma imagem de ~512 KB em base64.
const LOGO_MAX_LENGTH = 700_000;

const LOGO_MESSAGE =
  'Logo deve ser uma URL https:// ou uma imagem embutida (png, jpeg, webp ou svg).';

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

  @IsOptional()
  @IsString()
  @MaxLength(LOGO_MAX_LENGTH, { message: 'Logo muito grande (maximo ~512 KB).' })
  @Matches(LOGO_PATTERN, { message: LOGO_MESSAGE })
  logoLightUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LOGO_MAX_LENGTH, { message: 'Logo muito grande (maximo ~512 KB).' })
  @Matches(LOGO_PATTERN, { message: LOGO_MESSAGE })
  logoDarkUrl?: string;

  @IsOptional() @IsString() nfceEnvironment?: string;
  @IsOptional() @IsString() nfceCscId?: string;
  @IsOptional() @IsString() nfceCsc?: string;
  @IsOptional() @IsString() fiscalProvider?: string;
  @IsOptional() @IsString() fiscalProviderToken?: string;
}
