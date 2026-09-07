import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';

const EMPTY = {
  legalName: '',
  tradeName: null,
  cnpj: '',
  taxRegime: 'SIMPLES_NACIONAL' as const,
  addressStreet: '',
  addressNumber: '',
  addressDistrict: '',
  addressCity: '',
  addressState: '',
  addressZip: '',
};

@Injectable()
export class StoreSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const settings = await this.prisma.storeSettings.findFirst();
    if (!settings) return null;
    // Nunca expor o token do provedor fiscal nem o CSC em leitura.
    const { fiscalProviderToken, nfceCsc, ...safe } = settings;
    return {
      ...safe,
      hasFiscalToken: Boolean(fiscalProviderToken),
      hasCsc: Boolean(nfceCsc),
    };
  }

  /** Subconjunto publico: apenas a identidade visual, para a tela de login. */
  async branding() {
    const s = await this.prisma.storeSettings.findFirst({
      select: {
        tradeName: true,
        legalName: true,
        logoLightUrl: true,
        logoDarkUrl: true,
      },
    });
    return (
      s ?? {
        tradeName: null,
        legalName: null,
        logoLightUrl: null,
        logoDarkUrl: null,
      }
    );
  }

  /**
   * Liga/desliga o modo de contingencia da NFC-e ("a SEFAZ caiu, continue
   * vendendo"). Escreve APENAS `nfceContingencyActive` — nunca toca no
   * ambiente. Exige que a contingencia esteja configurada (serie da loja) para
   * ligar, senao a venda seguinte tentaria alocar numero e falharia no balcao.
   */
  async setContingency(active: boolean) {
    const current = await this.prisma.storeSettings.findFirst();
    if (!current) {
      throw new BadRequestException(
        'Preencha os dados da loja antes de ativar a contingência.',
      );
    }
    if (active && current.nfceContingencySeries == null) {
      throw new BadRequestException(
        'Defina a série de contingência da NFC-e antes de ativar o modo de contingência.',
      );
    }
    return this.prisma.storeSettings.update({
      where: { id: current.id },
      data: { nfceContingencyActive: active },
      select: { nfceContingencyActive: true, nfceContingencySeries: true },
    });
  }

  async update(dto: UpdateStoreSettingsDto) {
    const data = this.normalize(dto);
    const current = await this.prisma.storeSettings.findFirst();
    if (!current) {
      return this.prisma.storeSettings.create({ data: { ...EMPTY, ...data } });
    }
    return this.prisma.storeSettings.update({
      where: { id: current.id },
      data,
    });
  }

  /**
   * String vazia nos campos de logo significa "remover" -> grava null.
   * Campo ausente permanece intocado.
   */
  private normalize(dto: UpdateStoreSettingsDto) {
    const { logoLightUrl, logoDarkUrl, ...rest } = dto;
    return {
      ...rest,
      ...(logoLightUrl !== undefined
        ? { logoLightUrl: logoLightUrl === '' ? null : logoLightUrl }
        : {}),
      ...(logoDarkUrl !== undefined
        ? { logoDarkUrl: logoDarkUrl === '' ? null : logoDarkUrl }
        : {}),
    };
  }
}
