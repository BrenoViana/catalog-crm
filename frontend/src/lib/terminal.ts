/**
 * Nome do terminal (caixa) — é uma característica do DISPOSITIVO, não da loja
 * nem do operador, então vive no localStorage e viaja junto com a venda e a
 * abertura de turno para permitir conciliação por caixa.
 */
const KEY = 'catalog.terminal';
const MAX = 40;

export function getTerminal(): string {
  try {
    return (localStorage.getItem(KEY) ?? '').slice(0, MAX);
  } catch {
    return '';
  }
}

export function setTerminal(name: string): string {
  const value = name.trim().slice(0, MAX);
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage indisponível: o terminal vale só para esta sessão */
  }
  return value;
}
