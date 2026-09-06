import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthorizationService } from '../access/authorization.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { RequireModule } from '../license/module.guard';
import {
  CreatePromotionDto,
  SimulatePromotionsDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { PromotionsService } from './promotions.service';

/** Campos que descrevem a regra — o que precisa constar na trilha. */
const CAMPOS_REGRA = [
  'name',
  'kind',
  'scope',
  'productId',
  'categoryId',
  'value',
  'buyQty',
  'payQty',
  'minQuantity',
  'startsAt',
  'endsAt',
  'priority',
  'active',
] as const;

type RegraCrua = Record<string, unknown> | null;

/** Decimal e Date viram texto para caber no JSON do AuditLog. */
function serializaRegra(row: RegraCrua) {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const campo of CAMPOS_REGRA) {
    const v = row[campo];
    out[campo] = v instanceof Date ? v.toISOString() : v === null ? null : String(v);
  }
  return out;
}

/** So o que realmente mudou, com valor de antes e de depois. */
function diffRegra(antes: RegraCrua, depois: RegraCrua) {
  const a = serializaRegra(antes) ?? {};
  const b = serializaRegra(depois) ?? {};
  return CAMPOS_REGRA.filter((c) => a[c] !== b[c]).map((c) => ({
    campo: c,
    de: a[c] ?? null,
    para: b[c] ?? null,
  }));
}

@RequireModule('promocoes')
@Controller('promotions')
export class PromotionsController {
  constructor(
    private readonly promotions: PromotionsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @RequirePermissions('promotions.view')
  @Get()
  list() {
    return this.promotions.list();
  }

  /**
   * Simulacao para o PDV mostrar o desconto ao cliente antes de fechar.
   * Exige apenas `sales.create`: quem opera o balcao precisa ver o preco.
   * O valor devolvido aqui NAO e o que vale — a venda recalcula.
   */
  @RequirePermissions('sales.create')
  @Post('simulate')
  simulate(@Body() dto: SimulatePromotionsDto) {
    return this.promotions.simulate(dto.items);
  }

  /**
   * Criar, alterar e remover promocao muda o preco que a loja pratica. Vai
   * para a trilha: e a diferenca entre uma campanha e um desconto plantado.
   */
  @RequirePermissions('promotions.manage')
  @Post()
  async create(
    @Body() dto: CreatePromotionDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const created = await this.promotions.create(dto);
    await this.authorization.record({
      action: 'promotions.create',
      actorId,
      targetType: 'Promotion',
      targetId: created.id,
      detail: { nome: created.name, tipo: created.kind, escopo: created.scope },
    });
    return created;
  }

  @RequirePermissions('promotions.manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const before = await this.promotions.findRaw(id);
    const updated = await this.promotions.update(id, dto);
    // Guardar so os NOMES dos campos nao servia de nada: subir um desconto de
    // 5% para 90% ficava indistinguivel de corrigir o nome da campanha.
    await this.authorization.record({
      action: 'promotions.update',
      actorId,
      targetType: 'Promotion',
      targetId: id,
      detail: { mudancas: diffRegra(before, updated) },
    });
    return updated;
  }

  @RequirePermissions('promotions.manage')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser('userId') actorId: string,
  ) {
    // `remove` apaga a linha de verdade: a trilha e a UNICA copia que sobra da
    // regra que precificou vendas passadas. Promotion nao tem coluna sensivel.
    const before = await this.promotions.findRaw(id);
    const result = await this.promotions.remove(id);
    await this.authorization.record({
      action: 'promotions.delete',
      actorId,
      targetType: 'Promotion',
      targetId: id,
      detail: { regra: serializaRegra(before) },
    });
    return result;
  }
}
