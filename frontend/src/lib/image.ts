/**
 * Processamento da foto do produto — tudo no navegador.
 *
 * A loja fotografa com o celular ou arrasta um arquivo de 5 MB do fornecedor;
 * o que o servidor recebe é sempre a mesma coisa: um quadrado pequeno em WebP.
 * Fazer isso aqui tem três motivos práticos:
 *
 * 1. A rede da loja é o gargalo — subir 60 KB em vez de 5 MB muda a sensação
 *    de "salvou na hora" no balcão.
 * 2. O backend não precisa de biblioteca nativa de imagem (sharp/libvips), que
 *    é a dependência que mais costuma quebrar deploy em Windows.
 * 3. O recorte é WYSIWYG: a mesma função desenha a prévia e o arquivo final,
 *    então o que o usuário enquadrou é exatamente o que fica salvo.
 *
 * O servidor não confia em nada disso: reconfere tipo, bytes mágicos e tamanho.
 */

/** Lado do arquivo de exibição (aberto na ampliação e no editor). */
const FULL_SIZE = 1000;
/** Lado da miniatura usada em tabela, grade e PDV. */
const THUMB_SIZE = 200;
/** Trabalhar acima disso só gasta memória: o resultado nunca passa de 1000px. */
const SOURCE_MAX = 1600;

/** Teto do arquivo aceito para leitura (o resultado sai ~50x menor). */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Enquadramento escolhido no editor, em unidades independentes de tela. */
export interface CropView {
  /** 1 = a imagem preenche o quadrado (cover). Acima disso, aproxima. */
  scale: number;
  /** Deslocamento do centro, em frações do lado do quadrado. */
  offsetX: number;
  offsetY: number;
  /** Giro em graus, sempre múltiplo de 90. */
  rotation: number;
}

export const DEFAULT_CROP: CropView = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export interface EncodedPhoto {
  /** data URI da versão de exibição. */
  image: string;
  /** data URI da miniatura. */
  thumb: string;
  /** Soma dos dois, em bytes — é o que aparece como "peso" na interface. */
  byteSize: number;
}

export class ImageError extends Error {}

/** Lê um arquivo (ou um blob colado) como imagem decodificada. */
export function readImage(file: Blob): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new ImageError('O arquivo escolhido não é uma imagem.'));
  }
  // O `accept` do seletor de arquivo já barra SVG, mas arrastar e colar não
  // passam por ele. Nenhum SVG chega a ser guardado (tudo vira WebP/JPEG no
  // recorte), mas um arquivo vetorial patológico de até 12 MB trava a aba de
  // quem está catalogando — e essa pessoa está no balcão.
  if (file.type === 'image/svg+xml') {
    return Promise.reject(new ImageError('SVG não é aceito como foto de produto.'));
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.reject(
      new ImageError(
        `Imagem muito grande (${formatBytes(file.size)}). O limite é ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new ImageError('Não foi possível ler esta imagem.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError('Não foi possível ler esta imagem. Tente PNG, JPEG ou WebP.'));
    };
    img.src = url;
  });
}

/**
 * Normaliza a origem: aplica o giro e reduz para no máximo `SOURCE_MAX`.
 *
 * Fica em cache no editor (uma vez por arquivo + giro) porque é o passo caro —
 * arrastar e dar zoom depois só redesenham a partir deste canvas já pronto.
 */
export function prepareSource(img: HTMLImageElement, rotation: number): HTMLCanvasElement {
  const turn = ((rotation % 360) + 360) % 360;
  const swap = turn === 90 || turn === 270;

  const scale = Math.min(1, SOURCE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;

  const ctx = context(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}

/**
 * Limita o deslocamento para que a imagem sempre cubra o quadrado — sem isso
 * o enquadramento poderia deixar uma faixa vazia na borda.
 */
export function clampCrop(source: { width: number; height: number }, view: CropView): CropView {
  const scale = Math.min(4, Math.max(1, view.scale));
  const cover = 1 / Math.min(source.width, source.height);
  const drawnW = source.width * cover * scale;
  const drawnH = source.height * cover * scale;
  const limitX = Math.max(0, (drawnW - 1) / 2);
  const limitY = Math.max(0, (drawnH - 1) / 2);
  return {
    scale,
    rotation: view.rotation,
    offsetX: Math.min(limitX, Math.max(-limitX, view.offsetX)),
    offsetY: Math.min(limitY, Math.max(-limitY, view.offsetY)),
  };
}

/**
 * Desenha o quadrado recortado. É a única função que sabe converter o
 * enquadramento em pixels — prévia e arquivo final passam pelos mesmos números,
 * o que garante que o resultado é o que estava na tela.
 */
export function drawSquare(
  source: CanvasImageSource & { width: number; height: number },
  view: CropView,
  size: number,
  canvas: HTMLCanvasElement,
) {
  canvas.width = size;
  canvas.height = size;
  const ctx = context(canvas);
  ctx.imageSmoothingQuality = 'high';
  // Fundo branco: JPEG não tem transparência e um PNG vazado ficaria preto.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const safe = clampCrop(source, view);
  const cover = size / Math.min(source.width, source.height);
  const drawnW = source.width * cover * safe.scale;
  const drawnH = source.height * cover * safe.scale;
  ctx.drawImage(
    source,
    size / 2 + safe.offsetX * size - drawnW / 2,
    size / 2 + safe.offsetY * size - drawnH / 2,
    drawnW,
    drawnH,
  );
}

/**
 * Gera as duas versões que o servidor guarda.
 *
 * WebP é a primeira escolha (cerca de metade do peso de um JPEG equivalente);
 * se o navegador não souber codificar, cai para JPEG sem alarde. A qualidade
 * baixa em degraus até o arquivo caber no limite do servidor, para uma foto
 * muito detalhada não ser recusada depois de o usuário já ter enquadrado.
 */
export async function encodePhoto(
  source: CanvasImageSource & { width: number; height: number },
  view: CropView,
): Promise<EncodedPhoto> {
  const full = document.createElement('canvas');
  drawSquare(source, view, FULL_SIZE, full);
  const small = document.createElement('canvas');
  drawSquare(source, view, THUMB_SIZE, small);

  const type = (await supportsWebp()) ? 'image/webp' : 'image/jpeg';
  const image = await toDataUrl(full, type, [0.82, 0.7, 0.58], 500_000);
  const thumb = await toDataUrl(small, type, [0.8, 0.68], 60_000);

  return { image, thumb, byteSize: byteLength(image) + byteLength(thumb) };
}

/** Peso aproximado do binário por trás de um data URI base64. */
export function byteLength(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------------ interno

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Este navegador não conseguiu processar a imagem.');
  return ctx;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function toDataUrl(
  canvas: HTMLCanvasElement,
  type: string,
  qualities: number[],
  maxBytes: number,
): Promise<string> {
  let last = '';
  for (const quality of qualities) {
    const encoded = await toBlob(canvas, type, quality);
    if (!encoded) continue;
    last = await blobToDataUrl(encoded);
    if (byteLength(last) <= maxBytes) return last;
  }
  if (!last) throw new ImageError('Não foi possível processar a imagem neste navegador.');
  throw new ImageError('A imagem ficou pesada demais mesmo comprimida. Tente outra foto.');
}

function blobToDataUrl(value: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageError('Falha ao ler a imagem gerada.'));
    reader.readAsDataURL(value);
  });
}

let webpSupport: Promise<boolean> | null = null;
/** Safari antigo não codifica WebP; a checagem é feita uma vez por sessão. */
function supportsWebp(): Promise<boolean> {
  if (!webpSupport) {
    webpSupport = (async () => {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const encoded = await toBlob(probe, 'image/webp', 0.8);
      return encoded?.type === 'image/webp';
    })();
  }
  return webpSupport;
}
