import './SettingsPage.css';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { licenseApi, storeSettingsApi, type StoreSettings } from '../lib/api-client';

/** Durante a edição alguns campos numéricos carregam o texto cru do input. */
type Form = { [K in keyof StoreSettings]?: StoreSettings[K] | string };

/** Campos que o backend aceita no PUT — o GET devolve mais que isso (id, updatedAt, flags). */
const EDITABLE = [
  'legalName',
  'tradeName',
  'cnpj',
  'ie',
  'im',
  'taxRegime',
  'addressStreet',
  'addressNumber',
  'addressComplement',
  'addressDistrict',
  'addressCity',
  'addressState',
  'addressZip',
  'phone',
  'email',
  'logoLightUrl',
  'logoDarkUrl',
  'nfceEnvironment',
  'maxDiscountPercentOperator',
] as const satisfies readonly (keyof StoreSettings)[];

const MAX_LOGO_BYTES = 512 * 1024;

function toPayload(form: Form): Partial<StoreSettings> {
  const payload: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    const value = form[key];
    if (value === undefined) continue;
    if (key === 'maxDiscountPercentOperator') {
      payload[key] = Number(value) || 0;
      continue;
    }
    payload[key] = value === null ? '' : value;
  }
  return payload as Partial<StoreSettings>;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function LogoSlot({
  title,
  hint,
  preview,
  value,
  onPick,
  onClear,
}: {
  title: string;
  hint: string;
  preview: 'on-dark' | 'on-light';
  value: string | null | undefined;
  onPick: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      setError('Use PNG, JPEG, WEBP ou SVG.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(`Arquivo muito grande (${Math.round(file.size / 1024)} KB). Máximo 512 KB.`);
      return;
    }
    try {
      onPick(await readAsDataUrl(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler o arquivo.');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="logo-slot">
      <strong>{title}</strong>
      <div className={`logo-preview ${preview}`}>
        {value ? (
          <img src={value} alt={title} />
        ) : (
          <span className="placeholder">Sem logo — usa a marca padrão</span>
        )}
      </div>
      <div className="logo-actions">
        <label className="file-button">
          {value ? 'Trocar imagem' : 'Escolher imagem'}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
        {value ? (
          <button type="button" className="ghost-button" onClick={onClear}>
            Remover
          </button>
        ) : null}
      </div>
      <small>{hint}</small>
      {error ? <small style={{ color: 'var(--danger-text)' }}>{error}</small> : null}
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>({});
  const [licenseKey, setLicenseKey] = useState('');

  const store = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });
  const license = useQuery({ queryKey: ['license'], queryFn: licenseApi.get });

  useEffect(() => {
    if (store.data) setForm(store.data);
  }, [store.data]);

  const save = useMutation({
    mutationFn: () => storeSettingsApi.update(toPayload(form)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['store-settings'] }),
  });
  const activate = useMutation({
    mutationFn: () => licenseApi.update(licenseKey),
    onSuccess: () => {
      setLicenseKey('');
      queryClient.invalidateQueries({ queryKey: ['license'] });
    },
  });

  const set = (k: keyof StoreSettings, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Sistema</p>
          <h1>Configurações</h1>
        </div>
        <button className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Salvando…' : 'Salvar dados da loja'}
        </button>
      </div>

      {save.isSuccess ? <div className="success-message">Dados da loja salvos.</div> : null}
      {save.isError ? (
        <div className="error-message">
          {save.error instanceof Error ? save.error.message : 'Falha ao salvar.'}
        </div>
      ) : null}

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Identidade visual</h2>
        </div>
        <div className="logo-slots">
          <LogoSlot
            title="Logo — tema claro"
            hint="Exibido quando o sistema está no tema claro. Prefira arte escura sobre fundo transparente."
            preview="on-light"
            value={form.logoLightUrl}
            onPick={(dataUrl) => set('logoLightUrl', dataUrl)}
            onClear={() => set('logoLightUrl', '')}
          />
          <LogoSlot
            title="Logo — tema escuro"
            hint="Exibido quando o sistema está no tema escuro. Prefira arte clara sobre fundo transparente."
            preview="on-dark"
            value={form.logoDarkUrl}
            onPick={(dataUrl) => set('logoDarkUrl', dataUrl)}
            onClear={() => set('logoDarkUrl', '')}
          />
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          PNG, JPEG, WEBP ou SVG de até 512 KB. Sem logo, o sistema usa a marca padrão com a
          inicial do nome da loja. O tema é escolhido por usuário, no menu lateral.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Dados da loja (emitente da NFC-e)</h2>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Razão social</span>
            <input value={form.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} />
          </label>
          <label className="field">
            <span>Nome fantasia</span>
            <input value={form.tradeName ?? ''} onChange={(e) => set('tradeName', e.target.value)} />
          </label>
          <label className="field">
            <span>CNPJ</span>
            <input value={form.cnpj ?? ''} onChange={(e) => set('cnpj', e.target.value)} />
          </label>
          <label className="field">
            <span>Inscrição estadual</span>
            <input value={form.ie ?? ''} onChange={(e) => set('ie', e.target.value)} />
          </label>
          <label className="field">
            <span>Cidade</span>
            <input value={form.addressCity ?? ''} onChange={(e) => set('addressCity', e.target.value)} />
          </label>
          <label className="field">
            <span>UF</span>
            <input value={form.addressState ?? ''} onChange={(e) => set('addressState', e.target.value)} />
          </label>
          <label className="field">
            <span>Ambiente NFC-e</span>
            <select
              value={form.nfceEnvironment ?? 'homologacao'}
              onChange={(e) => set('nfceEnvironment', e.target.value)}
            >
              <option value="homologacao">Homologação</option>
              <option value="producao">Produção</option>
            </select>
          </label>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          Certificado digital, CSC e gateway fiscal serão configurados na etapa de
          integração da NFC-e.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Política de desconto</h2>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Limite de desconto do operador (%)</span>
            <input
              inputMode="decimal"
              value={form.maxDiscountPercentOperator ?? ''}
              onChange={(e) => set('maxDiscountPercentOperator', e.target.value)}
            />
          </label>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          Desconto total (itens + venda) que um operador pode conceder no PDV sem liberação.
          Gerente e administrador não têm limite.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Licença</h2>
        </div>
        <div className="settings-row">
          <span>Chave atual</span>
          <strong>{license.data?.key || '—'}</strong>
        </div>
        <div className="settings-row">
          <span>Situação</span>
          <span className={`tag ${license.data?.active ? 'tag-success' : 'tag-warning'}`}>
            {license.data?.active ? 'Ativa' : 'Inativa'}
          </span>
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          <span>Nova chave de ativação</span>
          <input value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} />
        </label>
        <button
          className="ghost-button"
          disabled={!licenseKey || activate.isPending}
          onClick={() => activate.mutate()}
        >
          {activate.isPending ? 'Ativando…' : 'Ativar'}
        </button>
      </section>
    </Layout>
  );
}
