import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseService } from './license.service';
import { MODULE_BY_KEY, type ModuleKey } from './module-catalog';

export const MODULE_KEY = 'moduloLicenciado';

/**
 * Marca a rota (ou o controller inteiro) como pertencente a um modulo vendido
 * separadamente. Rota sem o decorator e nucleo: nunca bloqueia.
 */
export const RequireModule = (module: ModuleKey) =>
  SetMetadata(MODULE_KEY, module);

/**
 * Excecao explicita: a rota pertence ao NUCLEO mesmo estando num controller
 * marcado com `@RequireModule`. O `getAllAndOverride` resolve o metadado do
 * handler por cima do da classe, entao isto desliga o gate so nesta rota.
 *
 * O valor e `null`, nao `undefined`: o Reflector do Nest PULA metadado
 * `undefined` (e indistinguivel de "sem metadado") e continuaria lendo o da
 * classe — a versao anterior deste decorator nao fazia nada. `null` e
 * definido e falsy, entao chega ao guard e cai no `if (!required)`.
 *
 * Existe para um caso concreto: a reabertura do dia. O dia fechado bloqueia a
 * abertura de caixa, entao deixar a reabertura atras da licenca faria uma
 * licenca vencida travar o balcao (SEC-073).
 */
export const CoreRoute = () =>
  SetMetadata<string, ModuleKey | null>(MODULE_KEY, null);

/**
 * Gate de licenca.
 *
 * Roda ANTES do PermissionsGuard de proposito: "seu plano não inclui Fiscal" e
 * uma mensagem util, "você não tem permissão" nao e — e o operador que liga
 * para o suporte repete a mensagem que viu.
 *
 * Devolve 403 com um corpo que diz qual modulo falta, para o frontend poder
 * oferecer o upgrade em vez de so mostrar erro.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly license: LicenseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ModuleKey | null | undefined>(
      MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // `null` vem de @CoreRoute(): rota de nucleo dentro de controller licenciado.
    if (!required) return true;

    if (await this.license.allows(required)) return true;

    const def = MODULE_BY_KEY.get(required);
    throw new ForbiddenException({
      statusCode: 403,
      error: 'ModuloNaoLicenciado',
      modulo: required,
      message:
        `O módulo "${def?.name ?? required}" não está incluído na licença ` +
        'desta instalação. O caixa segue funcionando normalmente.',
    });
  }
}
