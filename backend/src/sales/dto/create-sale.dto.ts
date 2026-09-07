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
  Matches,
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

  /** Codigo do terminal registrado, quando o dispositivo ja o conhece. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  terminalCode?: string;

  /**
   * Chave idempotente do dispositivo (fila offline). Um reenvio com o mesmo
   * `clientRef` devolve a venda ja gravada — nunca cria uma segunda. So vale
   * junto de um terminal identificado.
   */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/, {
    message: 'clientRef deve ter de 1 a 64 caracteres: letras, digitos, hifen ou sublinhado.',
  })
  clientRef?: string;
}
