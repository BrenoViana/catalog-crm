import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export enum PromotionKindDto {
  PERCENT = 'PERCENT',
  AMOUNT = 'AMOUNT',
  FIXED_PRICE = 'FIXED_PRICE',
  BUY_X_PAY_Y = 'BUY_X_PAY_Y',
}

export enum PromotionScopeDto {
  PRODUCT = 'PRODUCT',
  CATEGORY = 'CATEGORY',
  ALL = 'ALL',
}

export class CreatePromotionDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(PromotionKindDto)
  kind: PromotionKindDto;

  @IsEnum(PromotionScopeDto)
  scope: PromotionScopeDto;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /**
   * PERCENT: 0–100. AMOUNT/FIXED_PRICE: R$ por unidade.
   *
   * `@ValidateIf` no lugar de `@IsOptional`: o `IsOptional` pula TODOS os
   * validadores quando o valor e `null`, entao `{"value": null}` passava direto
   * e o merge do PATCH devolvia 200 mantendo o desconto antigo — a tela dizia
   * que salvou e a loja seguia praticando o valor velho (SEC-034).
   */
  @ValidateIf((_, v) => v !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @IsPositive()
  buyQty?: number;

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(0)
  payQty?: number;

  // Os tres abaixo aceitam `null` de proposito: null = LIMPAR o campo.
  // Sem isso nao havia como tornar permanente uma campanha com data de fim.
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  minQuantity?: number | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsISO8601()
  startsAt?: string | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsISO8601()
  endsAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Atualizacao PARCIAL: campo omitido fica como esta.
 *
 * Herdar de CreatePromotionDto sem PartialType tornava o PATCH uma substituicao
 * total — corrigir o nome de uma campanha encerrada zerava `endsAt` e a
 * ressuscitava valendo para sempre (SEC-029).
 */
export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}

export class SimulateItemDto {
  @IsUUID()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}

/**
 * Simulacao para o PDV mostrar o desconto antes de fechar. O corpo traz apenas
 * produto e quantidade: preco vem sempre do catalogo, nunca do cliente.
 */
export class SimulatePromotionsDto {
  @IsArray()
  @ArrayMinSize(1)
  // Sem teto, um corpo de 8 MB carrega ~135 mil itens: o ValidationPipe valida
  // cada um e o motor roda regras x linhas na thread unica. Qualquer operador
  // parava o backend da loja (SEC-031). Carrinho de balcao nao passa disto.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SimulateItemDto)
  items: SimulateItemDto[];
}
