import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ImportProductsDto {
  /** Conteudo bruto do arquivo CSV (o front le o arquivo e envia o texto). */
  @IsString()
  @MinLength(3)
  @MaxLength(4_000_000, { message: 'Arquivo muito grande (limite ~4 MB de texto).' })
  csv: string;

  /** Criar categorias que aparecerem no CSV e ainda nao existirem. Padrao: true. */
  @IsOptional()
  @IsBoolean()
  createCategories?: boolean;
}
