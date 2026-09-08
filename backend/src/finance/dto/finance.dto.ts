import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsIn,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  Matches,
  MinLength,
} from 'class-validator';

export enum SettlementMethodDto {
  DINHEIRO = 'DINHEIRO',
  PIX = 'PIX',
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
  OUTRO = 'OUTRO',
}

export enum PayableRecurrenceDto {
  NENHUMA = 'NENHUMA',
  SEMANAL = 'SEMANAL',
  MENSAL = 'MENSAL',
  BIMESTRAL = 'BIMESTRAL',
  TRIMESTRAL = 'TRIMESTRAL',
  SEMESTRAL = 'SEMESTRAL',
  ANUAL = 'ANUAL',
}

export enum TitleStatusDto {
  ABERTO = 'ABERTO',
  PARCIAL = 'PARCIAL',
  PAGO = 'PAGO',
  CANCELADO = 'CANCELADO',
}

export enum FinancialAccountTypeDto {
  BANCO = 'BANCO',
  CAIXA = 'CAIXA',
  CARTEIRA = 'CARTEIRA',
}

export enum FinancialCategoryKindDto {
  RECEITA = 'RECEITA',
  DESPESA = 'DESPESA',
}

// ------------------------------------------------------------- A receber

/** Titulo avulso: renegociacao, acerto de conta, venda antiga migrada. */
export class CreateReceivableDto {
  @IsUUID()
  customerId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  dueDate: string;

  // Mesmo motivo do teto na venda (SEC-064): parcelamento absurdo vira um
  // laco de INSERT dentro de uma transacao que segura lock de numeracao.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  installments?: number;

  /** Plano de contas de RECEITA (classificacao estruturada, opcional). */
  @IsOptional()
  @IsUUID()
  financialCategoryId?: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SettleTitleDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsEnum(SettlementMethodDto)
  method: SettlementMethodDto;

  /** Conta financeira em que o dinheiro entrou/saiu, quando nao foi pela gaveta. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class CancelTitleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}

export class SetCreditLimitDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit: number;
}

// -------------------------------------------------------------- A pagar

export class SupplierDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  document?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreatePayableDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  /** Plano de contas de DESPESA (classificacao estruturada, opcional). */
  @IsOptional()
  @IsUUID()
  financialCategoryId?: string;

  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsDateString()
  dueDate: string;

  /** Data de competencia, quando difere do vencimento. */
  @IsOptional()
  @IsDateString()
  competencia?: string;

  @IsOptional()
  @IsEnum(PayableRecurrenceDto)
  recurrence?: PayableRecurrenceDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// -------------------------------------------------------------- Consultas

export class ListTitlesQueryDto {
  @IsOptional()
  @IsEnum(TitleStatusDto)
  status?: TitleStatusDto;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** "true" lista apenas o que ja venceu e continua em aberto. */
  @IsOptional()
  @IsIn(['true', 'false'])
  overdue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}

export class PeriodQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Fechamento do dia. Sem `date`, fecha o dia de hoje. */
export class CloseDayDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  date?: string;

  /**
   * Total em especie conferido pelo gerente. Opcional, mas quando vem tem de
   * bater com a soma das contagens dos turnos — e a conferencia dele que
   * transforma o numero do sistema em numero assinado.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCash?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Reabertura de um dia fechado. O motivo e obrigatorio: vai para a trilha. */
export class ReopenDayDto {
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}

/** Consulta de um dia especifico do fechamento. */
export class DayQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data deve estar no formato AAAA-MM-DD.' })
  date?: string;
}

// -------------------------------------------------- Nucleo financeiro

export class CreateFinancialAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEnum(FinancialAccountTypeDto)
  type: FinancialAccountTypeDto;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankNumber?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @IsOptional()
  @IsDateString()
  openingDate?: string;
}

export class UpdateFinancialAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(FinancialAccountTypeDto)
  type?: FinancialAccountTypeDto;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankBranch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankNumber?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @IsOptional()
  @IsDateString()
  openingDate?: string;
}

export class CreateFinancialCategoryDto {
  /** Obrigatorio para raiz; herdado do pai quando ha `parentId`. */
  @IsOptional()
  @IsEnum(FinancialCategoryKindDto)
  kind?: FinancialCategoryKindDto;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateFinancialCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}

export class CostCenterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}

export class CreateTransferDto {
  @IsUUID()
  fromAccountId: string;

  @IsUUID()
  toAccountId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Filtro do plano de contas por natureza. */
export class CategoryTreeQueryDto {
  @IsOptional()
  @IsEnum(FinancialCategoryKindDto)
  kind?: FinancialCategoryKindDto;
}
