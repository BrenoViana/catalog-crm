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
    // Nunca expor o token do provedor fiscal em leitura.
    const { fiscalProviderToken, nfceCsc, ...safe } = settings;
    return {
      ...safe,
      hasFiscalToken: Boolean(fiscalProviderToken),
      hasCsc: Boolean(nfceCsc),
    };
  }

  async update(dto: UpdateStoreSettingsDto) {
    const current = await this.prisma.storeSettings.findFirst();
    if (!current) {
      return this.prisma.storeSettings.create({ data: { ...EMPTY, ...dto } });
    }
    return this.prisma.storeSettings.update({
      where: { id: current.id },
      data: dto,
    });
  }
}
