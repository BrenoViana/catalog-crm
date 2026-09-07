import { Injectable } from '@nestjs/common';

/**
 * Registro de metricas em memoria.
 *
 * Duas decisoes explicam o formato.
 *
 * **Fica em memoria, no processo.** Este PDV roda numa maquina na loja, nao num
 * cluster: subir Prometheus e um coletor ao lado seria mais infraestrutura do
 * que a loja tem quem opere. O custo e conhecido — reiniciar o backend zera os
 * numeros — e por isso a resposta carrega `desdeBoot`, para ninguem ler "3
 * vendas hoje" quando o processo subiu ha dez minutos.
 *
 * **A cardinalidade e fechada no codigo.** O rotulo de rota nunca vem da URL
 * crua: `/api/sales/<uuid>` viraria uma serie nova por venda e a memoria
 * cresceria com o movimento da loja. O que entra e o *caminho da rota* do Nest
 * (`/sales/:id`), e ainda assim com um teto duro de series — passando dele,
 * tudo cai num balde `outros`.
 */
const MAX_SERIES = 300;

/** Fronteiras do histograma de latencia, em ms. */
const BUCKETS = [5, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface RouteStat {
  count: number;
  errors: number;
  /** 4xx: recusa de autorizacao, validacao e rota inexistente. */
  recusas: number;
  totalMs: number;
  maxMs: number;
  buckets: number[];
}

@Injectable()
export class MetricsService {
  private readonly bootedAt = new Date();
  private readonly routes = new Map<string, RouteStat>();
  private readonly counters = new Map<string, number>();

  /** Uma requisicao concluida. `route` ja vem normalizada pelo interceptor. */
  observeRequest(method: string, route: string, status: number, ms: number) {
    const key = this.bounded(`${method} ${route}`, method);
    let stat = this.routes.get(key);
    if (!stat) {
      stat = {
        count: 0,
        errors: 0,
        recusas: 0,
        totalMs: 0,
        maxMs: 0,
        buckets: BUCKETS.map(() => 0),
      };
      this.routes.set(key, stat);
    }
    stat.count += 1;
    if (status >= 500) stat.errors += 1;
    else if (status >= 400) stat.recusas += 1;
    stat.totalMs += ms;
    if (ms > stat.maxMs) stat.maxMs = ms;
    const idx = BUCKETS.findIndex((b) => ms <= b);
    if (idx >= 0) stat.buckets[idx] += 1;
  }

  /**
   * Contador de negocio (venda concluida, NFC-e rejeitada, pagamento negado).
   * E o que a loja pergunta quando o dia parece estranho — e o que nao da para
   * responder olhando so latencia de rota.
   */
  increment(name: string, by = 1) {
    if (!this.counters.has(name) && this.counters.size >= MAX_SERIES) return;
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /**
   * Teto de cardinalidade: serie nova depois do limite cai em `outros`.
   *
   * A comparacao e com a chave COMPOSTA (`GET /sales/:id`), que e a que
   * indexa o mapa. Comparar so o caminho fazia o teste falhar sempre e, passado
   * o limite, ate rota ja conhecida caia em `outros` — o painel apagava
   * justamente quando havia mais o que olhar.
   */
  private bounded(key: string, method: string) {
    return this.routes.has(key) || this.routes.size < MAX_SERIES
      ? key
      : `${method} outros`;
  }

  snapshot() {
    const rotas = [...this.routes.entries()]
      .map(([rota, s]) => ({
        rota,
        requisicoes: s.count,
        erros5xx: s.errors,
        recusas4xx: s.recusas,
        mediaMs: s.count ? Math.round((s.totalMs / s.count) * 10) / 10 : 0,
        maxMs: Math.round(s.maxMs),
        // Percentil aproximado pelo histograma: a fronteira do balde em que o
        // 95o caso cai. Aproximado de proposito — guardar as amostras para um
        // p95 exato e memoria que este processo divide com o balcao.
        p95Ms: this.percentile(s, 0.95),
      }))
      .sort((a, b) => b.requisicoes - a.requisicoes);

    const total = rotas.reduce((acc, r) => acc + r.requisicoes, 0);
    const erros = rotas.reduce((acc, r) => acc + r.erros5xx, 0);
    const recusas = rotas.reduce((acc, r) => acc + r.recusas4xx, 0);

    return {
      geradoEm: new Date().toISOString(),
      // Sem isto o numero mente por omissao: metrica em memoria conta desde o
      // ultimo boot, nao desde a abertura da loja.
      desdeBoot: this.bootedAt.toISOString(),
      uptimeSegundos: Math.round((Date.now() - this.bootedAt.getTime()) / 1000),
      processo: {
        heapUsadoMb: Math.round((process.memoryUsage().heapUsed / 1048576) * 10) / 10,
        rssMb: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        versaoNode: process.version,
      },
      requisicoes: {
        total,
        erros5xx: erros,
        recusas4xx: recusas,
        taxaErro: total ? erros / total : 0,
      },
      rotas,
      contadores: Object.fromEntries([...this.counters.entries()].sort()),
      bucketsMs: BUCKETS,
    };
  }

  private percentile(stat: RouteStat, p: number): number | null {
    if (!stat.count) return null;
    const alvo = stat.count * p;
    let acumulado = 0;
    for (let i = 0; i < BUCKETS.length; i += 1) {
      acumulado += stat.buckets[i];
      if (acumulado >= alvo) return BUCKETS[i];
    }
    // Nao coube em nenhum balde: acima da ultima fronteira, o pior caso e o
    // unico numero honesto que sobra.
    return Math.round(stat.maxMs);
  }
}
