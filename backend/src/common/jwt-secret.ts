/**
 * Fonte unica do segredo do JWT (usado pela assinatura e pela verificacao).
 * Em producao o segredo e obrigatorio — sem fallback, para nunca assinar
 * tokens com uma chave publicamente conhecida.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET ausente ou com menos de 16 caracteres. Defina a variavel de ambiente.',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[auth] JWT_SECRET nao definido — usando segredo de desenvolvimento (inseguro).',
  );
  return 'dev-only-insecure-secret-change-me';
}
