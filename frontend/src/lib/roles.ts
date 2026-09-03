export type Role = 'ADMIN' | 'GERENTE' | 'OPERADOR';

const RANK: Record<Role, number> = { OPERADOR: 1, GERENTE: 2, ADMIN: 3 };

/** true se `role` tem pelo menos o nivel `min` (ADMIN > GERENTE > OPERADOR). */
export function atLeast(role: string | undefined | null, min: Role): boolean {
  return !!role && (RANK[role as Role] ?? 0) >= RANK[min];
}

/** Tela inicial por papel: gerencia cai no dashboard, operador direto no PDV. */
export function homePath(role: string | undefined | null): string {
  return atLeast(role, 'GERENTE') ? '/dashboard' : '/pdv';
}
