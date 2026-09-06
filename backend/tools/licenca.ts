/**
 * Ferramenta do FORNECEDOR para gerar par de chaves e emitir licencas.
 *
 * Nao faz parte do produto instalado na loja: fica aqui para nao se perder, mas
 * a chave PRIVADA nunca deve entrar neste repositorio nem no build. Guarde-a
 * fora — gerenciador de segredos, cofre, ou no minimo um arquivo com permissao
 * restrita fora da arvore do projeto.
 *
 * Uso:
 *
 *   # 1. uma vez: gera o par
 *   npx ts-node tools/licenca.ts gerar-par
 *
 *   # 2. a cada venda/renovacao
 *   LICENSE_PRIVATE_KEY_FILE=/caminho/seguro/privada.pem \
 *   npx ts-node tools/licenca.ts emitir \
 *     --cliente "Mercado do Ze" \
 *     --cnpj 12345678000190 \
 *     --modulos fiscal,promocoes,relatorios \
 *     --dias 395
 *
 *   # 3. conferir uma chave emitida
 *   LICENSE_PUBLIC_KEY_FILE=/caminho/publica.pem \
 *   npx ts-node tools/licenca.ts verificar CATALOG-1.xxx.yyy
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { LICENSE_PREFIX, verifyLicenseKey, type LicensePayload } from '../src/license/license-key';
import { SELLABLE_MODULES, type ModuleKey } from '../src/license/module-catalog';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Recusa escrever a chave privada dentro de um repositorio git.
 *
 * Uma linha de `.gitignore` e pouco para separar a chave-mestra do produto de
 * um `git add -f` distraido, de um `COPY . .` num Dockerfile futuro ou de um
 * backup da pasta. O lugar da chave privada e fora da arvore do projeto.
 */
function recusarDentroDoRepo(destino: string) {
  let dir = resolve(destino);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, '.git'))) {
      throw new Error(
        `Recusando escrever chave em "${dir}": e um repositorio git.\n` +
          'Use --saida <caminho fora do projeto>, por exemplo:\n' +
          '  npx ts-node tools/licenca.ts gerar-par --saida ~/.catalog-licencas',
      );
    }
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
}

function gerarPar() {
  const destino = arg('saida') ?? process.cwd();
  recusarDentroDoRepo(destino);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const pub = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const privPath = join(destino, 'licenca-privada.pem');
  const pubPath = join(destino, 'licenca-publica.pem');
  // `mode` nao tem efeito no Windows; a protecao real e o arquivo estar fora
  // do repositorio e num diretorio de acesso restrito.
  writeFileSync(privPath, priv, { mode: 0o600 });
  writeFileSync(pubPath, pub);
  console.log(`Gerado:\n  ${privPath}  (CHAVE-MESTRA — nunca compartilhe)\n  ${pubPath}`);
  console.log('\nNo .env de cada instalacao, use a publica em uma linha:\n');
  console.log(`LICENSE_PUBLIC_KEY="${pub.replace(/\n/g, '\\n')}"`);
}

function emitir() {
  const file = process.env.LICENSE_PRIVATE_KEY_FILE;
  if (!file) throw new Error('Defina LICENSE_PRIVATE_KEY_FILE com o caminho da chave privada.');
  const privateKey = createPrivateKey(readFileSync(file, 'utf8'));

  const cliente = arg('cliente');
  if (!cliente) throw new Error('--cliente e obrigatorio.');

  const modulosRaw = (arg('modulos') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  const invalidos = modulosRaw.filter((m) => !(SELLABLE_MODULES as string[]).includes(m));
  if (invalidos.length) {
    throw new Error(
      `Modulo(s) desconhecido(s): ${invalidos.join(', ')}. Validos: ${SELLABLE_MODULES.join(', ')}`,
    );
  }

  const dias = Number(arg('dias') ?? 395);
  if (!Number.isFinite(dias) || dias <= 0) throw new Error('--dias invalido.');

  const agora = new Date();
  const payload: LicensePayload = {
    cliente,
    cnpj: arg('cnpj'),
    modulos: modulosRaw as ModuleKey[],
    emitidaEm: agora.toISOString(),
    expiraEm: new Date(agora.getTime() + dias * 86_400_000).toISOString(),
    jti: randomUUID(),
  };

  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const assinatura = sign(null, Buffer.from(`${LICENSE_PREFIX}.${payloadB64}`, 'utf8'), privateKey);
  const chave = `${LICENSE_PREFIX}.${payloadB64}.${b64url(assinatura)}`;

  console.log('\n--- CHAVE ---\n');
  console.log(chave);
  console.log('\n--- CONTEUDO (legivel, nao e segredo) ---\n');
  console.log(JSON.stringify(payload, null, 2));
}

function verificar() {
  const file = process.env.LICENSE_PUBLIC_KEY_FILE;
  if (!file) throw new Error('Defina LICENSE_PUBLIC_KEY_FILE.');
  const chave = process.argv[3];
  if (!chave) throw new Error('Passe a chave como argumento.');
  const r = verifyLicenseKey(chave, readFileSync(file, 'utf8'));
  console.log(JSON.stringify(r, null, 2));
}

const cmd = process.argv[2];
try {
  if (cmd === 'gerar-par') gerarPar();
  else if (cmd === 'emitir') emitir();
  else if (cmd === 'verificar') verificar();
  else {
    console.log('Comandos: gerar-par | emitir | verificar');
    process.exit(1);
  }
} catch (err) {
  console.error('ERRO:', err instanceof Error ? err.message : err);
  process.exit(1);
}
