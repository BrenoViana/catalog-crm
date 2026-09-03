import { Layout } from '../components/Layout';

export function SettingsPage() {
  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Sistema</p>
          <h1>Configurações</h1>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel">
          <h2>Perfil da empresa</h2>
          <div className="settings-row">
            <span>Nome da empresa</span>
            <strong>Catalog CRM</strong>
          </div>
          <div className="settings-row">
            <span>Modo visual</span>
            <button className="ghost-button">Dark premium</button>
          </div>
        </section>

        <section className="panel">
          <h2>Licença</h2>
          <div className="settings-row">
            <span>Status</span>
            <strong>Ativa</strong>
          </div>
          <div className="settings-row">
            <span>Chave</span>
            <button className="primary-button">Atualizar licença</button>
          </div>
        </section>
      </div>
    </Layout>
  );
}
