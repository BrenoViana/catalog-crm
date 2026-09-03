import { Injectable } from '@nestjs/common';
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
