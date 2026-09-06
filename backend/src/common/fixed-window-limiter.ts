/**
 * Janela fixa em memoria, compartilhada pelos guards de rate limit.
 *
 * Suficiente para o backend de uma loja unica. Duas limitacoes conhecidas, que
 * valem para todos os usos: o contador some no restart do processo e nao e
 * compartilhado entre instancias. Trocar por Redis muda so este arquivo.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

/** Quantas chaves guardar antes de varrer as expiradas. */
const SWEEP_AT = 5000;

export class FixedWindowLimiter {
  private readonly hits = new Map<string, Bucket>();

  /**
   * Conta uma tentativa em cada chave e devolve os segundos que faltam para
   * liberar, ou `null` quando ainda esta dentro do limite.
   *
   * Contar em varias chaves ao mesmo tempo e o que evita os dois extremos: so
   * por IP, um NAT trava a loja inteira; so por usuario, trocar de alvo a cada
   * tentativa escapa do limite.
   */
  hit(keys: string[], max: number, windowMs: number): number | null {
    const now = Date.now();

    if (this.hits.size > SWEEP_AT) {
      for (const [k, b] of this.hits) if (now >= b.resetAt) this.hits.delete(k);
    }

    let blocked: Bucket | undefined;
    for (const key of keys) {
      let bucket = this.hits.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        this.hits.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > max && (!blocked || bucket.resetAt < blocked.resetAt)) {
        blocked = bucket;
      }
    }

    return blocked ? Math.ceil((blocked.resetAt - now) / 1000) : null;
  }
}

/** IP real do cliente. Depende de `app.set('trust proxy', ...)` em main.ts. */
export function clientIp(req: {
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
