import { Layout } from '../components/Layout';
import { PromotionsManager } from '../components/PromotionsModal';

/**
 * Tela própria de campanhas, alcançável por quem tem `promotions.manage`.
 *
 * O gerente administra catálogo e promoção sem precisar de `settings.manage`,
 * que carregaria junto dados do emitente, CSC e o teto de desconto do operador.
 */
export function PromotionsPage() {
  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Promoções</h1>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0, marginBottom: 20, maxWidth: '62ch' }}>
        Campanhas de desconto automático. O servidor recalcula o desconto no
        fechamento da venda — o operador não digita nada, e a campanha não
        consome o teto de desconto dele.
      </p>

      <PromotionsManager />
    </Layout>
  );
}
