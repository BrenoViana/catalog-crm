import { useQuery } from '@tanstack/react-query';
import { licenseApi, type LicenseStatus, type ModuleKey } from './api-client';

/**
 * Estado de licença da instalação, compartilhado por toda a interface.
 *
 * Serve para ESCONDER o que não está licenciado, não para proteger: quem decide
 * é o servidor, que responde 403 com `error: "ModuloNaoLicenciado"`. Aqui a
 * função é não oferecer ao lojista um botão que vai falhar.
 *
 * Enquanto carrega, `allows` devolve `true`: é melhor exibir um item por um
 * instante e ele sumir do que piscar um menu incompleto a cada navegação.
 */
export function useLicense() {
  const query = useQuery({
    queryKey: ['license-status'],
    queryFn: () => licenseApi.status(),
    // O estado muda raramente (renovação é diária); não vale rebuscar a cada tela.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const status: LicenseStatus | undefined = query.data;

  const allows = (module: ModuleKey) => {
    if (module === 'core') return true;
    if (!status) return true;
    return status.modulos.includes(module);
  };

  return {
    status,
    allows,
    carregando: query.isLoading,
    /** Frase para o banner; vazia quando não há o que avisar. */
    aviso: status?.aviso ?? '',
    situacao: status?.situacao,
  };
}

/** Permissões que dependem de módulo acessório — espelha o catálogo do backend. */
export const MODULE_OF_PERMISSION: Record<string, ModuleKey> = {
  'fiscal.view': 'fiscal',
  'fiscal.emit': 'fiscal',
  'fiscal.cancel': 'fiscal',
  'promotions.view': 'promocoes',
  'promotions.manage': 'promocoes',
  'loyalty.redeem': 'promocoes',
  'loyalty.manage': 'promocoes',
  'finance.view': 'financeiro',
  'finance.receivables.manage': 'financeiro',
  'finance.payables.manage': 'financeiro',
  'dashboard.view': 'relatorios',
  'reports.view': 'relatorios',
  'reports.export': 'relatorios',
  'reports.schedule': 'relatorios',
};
