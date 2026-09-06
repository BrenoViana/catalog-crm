import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateLicenseDto {
  @IsString()
  @IsNotEmpty()
  // O corpo aceita 8 MB e `License.key` e indice unico: acima de ~2704 bytes o
  // btree do Postgres estoura e a rota devolve 500 em vez de 400.
  @MaxLength(4096)
  key: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;
}
