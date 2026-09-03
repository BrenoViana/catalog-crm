import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { licenseApi, storeSettingsApi, type StoreSettings } from '../lib/api-client';

type Form = Partial<StoreSettings>;

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
    mutationFn: () => storeSettingsApi.update(form),
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
