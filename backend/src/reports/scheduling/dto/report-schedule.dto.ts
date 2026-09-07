import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { EXPORTABLE } from '../../report-csv.service';

const FREQUENCIES = ['DIARIO', 'SEMANAL', 'MENSAL'] as const;
const CHANNELS = ['REGISTRO', 'EMAIL', 'WHATSAPP'] as const;

/**
 * O destinatario tem de casar com o CANAL escolhido.
 *
 * Sem esta checagem, um telefone gravado num agendamento de e-mail so aparece
 * como problema no dia do envio, dentro de um job que ninguem esta olhando — e
 * o gestor descobre que nao recebe o relatorio semanas depois.
 */
@ValidatorConstraint({ name: 'recipientMatchesChannel' })
class RecipientMatchesChannel implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (typeof value !== 'string') return false;
    const channel = (args.object as { channel?: string }).channel;
    const v = value.trim();
    if (channel === 'EMAIL') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (channel === 'WHATSAPP') {
      const digits = v.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    }
    // REGISTRO nao envia para lugar nenhum: qualquer rotulo curto serve.
    return v.length >= 1 && v.length <= 120;
  }

  defaultMessage(args: ValidationArguments) {
    const channel = (args.object as { channel?: string }).channel;
    if (channel === 'EMAIL') return 'Informe um e-mail válido para o canal E-mail.';
    if (channel === 'WHATSAPP') return 'Informe um telefone com DDD para o canal WhatsApp.';
    return 'Destinatário inválido.';
  }
}

export class CreateReportScheduleDto {
  @IsIn(EXPORTABLE as unknown as string[], {
    message: `report deve ser um de: ${EXPORTABLE.join(', ')}`,
  })
  report!: string;

  @IsString()
  @Length(3, 80)
  name!: string;

  @IsIn(FREQUENCIES as unknown as string[])
  frequency!: (typeof FREQUENCIES)[number];

  @IsInt()
  @Min(0)
  @Max(23)
  hour!: number;

  /** Obrigatorio no semanal; 0 = domingo. */
  @ValidateIf((o) => o.frequency === 'SEMANAL')
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  /**
   * Obrigatorio no mensal. Teto 28 de proposito: dia 29, 30 e 31 nao existem em
   * todo mes, e um agendamento que pula fevereiro falha silenciosamente.
   */
  @ValidateIf((o) => o.frequency === 'MENSAL')
  @IsInt()
  @Min(1)
  @Max(28)
  monthday?: number;

  @IsIn(CHANNELS as unknown as string[])
  channel!: (typeof CHANNELS)[number];

  @IsString()
  @Length(1, 120)
  @Validate(RecipientMatchesChannel)
  recipient!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateReportScheduleDto extends PartialType(CreateReportScheduleDto) {}
