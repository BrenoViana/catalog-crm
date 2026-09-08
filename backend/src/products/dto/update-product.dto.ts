import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  /** UNIT = por unidade; WEIGHT = por peso (preco por kg). */
  @IsOptional()
  @IsIn(['UNIT', 'WEIGHT'])
  pricingMode?: 'UNIT' | 'WEIGHT';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  /**
   * Foto por URL externa. Exigimos https e limitamos o tamanho porque este
   * valor vira `<img src>` em toda linha de Produtos, de Estoque e do PDV: um
   * endereco plantado aqui seria um pixel de rastreamento no balcao, contando a
   * um terceiro o IP da loja e o horario em que o caixa esta ativo.
   */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  taxGroupId?: string;
}
