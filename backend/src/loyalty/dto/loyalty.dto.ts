import { IsNumber, Max, Min, IsString, MaxLength, MinLength } from 'class-validator';

export class AdjustLoyaltyDto {
  /**
   * Positivo credita, negativo debita. Zero e recusado pelo servico.
   * O teto evita que um clique errado credite um valor que estoura o
   * `Decimal(12,2)` da coluna e passe a falhar por erro de banco (SEC-069).
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100_000)
  @Max(100_000)
  amount: number;

  /**
   * Obrigatorio: um ajuste manual de saldo e dinheiro criado ou apagado a mao.
   * Sem motivo escrito, a trilha nao explica nada a quem for auditar depois.
   */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason: string;
}
