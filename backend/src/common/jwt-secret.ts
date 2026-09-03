/**
 * Fonte unica do segredo do JWT (assinatura e verificacao usam o mesmo valor).
 *
 * Regras:
 * - Fora de desenvolvimento (NODE_ENV !== 'development') o JWT_SECRET e
 *   OBRIGATORIO: >= 32 caracteres e nao pode ser um placeholder conhecido.
 *   Qualquer violacao aborta o boot (falha fechada).
 * - Em desenvolvimento, cai para um segredo fixo apenas se JWT_SECRET nao
 *   estiver definido, com aviso no console.
 */
const PLACEHOLDER_PATTERNS = [
  'change-me',
  'changeme',
  'troque',
  'super-secret',
  'secret-key',
  'your-secret',
  'insecure',
  'example',
];

const DEV_FALLBACK = 'dev-only-insecure-secret-change-me-0123456789';

export function getJwtSecret(): string {
  const isDev = (process.env.NODE_ENV ?? 'development') === 'development';
  const secret = process.env.JWT_SECRET?.trim();

  const looksLikePlaceholder = (value: string) =>
    PLACEHOLDER_PATTERNS.some((p) => value.toLowerCase().includes(p));

  if (secret && secret.length >= 32 && !looksLikePlaceholder(secret)) {
    return secret;
  }

  if (!isDev) {
    if (!secret) {
      throw new Error('JWT_SECRET nao definido. Configure um segredo forte (>= 32 caracteres).');
    }
    if (secret.length < 32) {
      throw new Error('JWT_SECRET muito curto (minimo 32 caracteres).');
    }
    throw new Error('JWT_SECRET parece um valor de exemplo/placeholder. Gere um segredo aleatorio.');
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[auth] JWT_SECRET ausente/fraco em desenvolvimento — usando segredo local inseguro. ' +
      'Defina JWT_SECRET (>= 32 chars) antes de qualquer deploy.',
  );
  return DEV_FALLBACK;
}
