import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum PaymentMethodDto {
  DINHEIRO = 'DINHEIRO',
  PIX = 'PIX',
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
  CREDIARIO = 'CREDIARIO',
  OUTRO = 'OUTRO',
  /** Resgate do saldo de fidelidade do cliente. Exige `customerId`. */
  FIDELIDADE = 'FIDELIDADE',
}

export class SaleItemInput {
  @IsUUID()
  productId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  // Desconto por item (em R$). O preco unitario NUNCA vem do cliente —
  // e sempre o preco cadastrado do produto (ver SalesService.create).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
}

export class SalePaymentInput {
  @IsEnum(PaymentMethodDto)
  method: PaymentMethodDto;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  /**
   * Teto duro no DTO. Sem ele, `installments: 1000000` no crediario fazia a
   * venda inserir um milhao de titulos DENTRO da transacao que ja segura o
   * advisory lock da numeracao global — uma requisicao parava todos os caixas
   * da loja (SEC-064). O limite operacional real ainda e `sales.maxInstallments`,
   * conferido no servico; aqui o teto so impede o absurdo.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  installments?: number;
}

export class CreateSaleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInput)
  items: SaleItemInput[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentInput)
  payments: SalePaymentInput[];

  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** Desconto aplicado sobre o total da venda (em R$). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Nome do terminal/caixa (por dispositivo) que registrou a venda. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  terminal?: string;
}
