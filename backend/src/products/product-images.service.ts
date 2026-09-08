import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Foto do produto: valida o que o navegador enviou, guarda os bytes e devolve
 * a imagem para a rota publica que a serve.
 *
 * O recorte e a recompressao acontecem no NAVEGADOR (frontend/src/lib/image.ts):
 * o servidor recebe uma imagem quadrada ja pequena, em duas versoes. Isso evita
 * uma dependencia nativa de processamento de imagem no backend — mas justamente
 * por isso NADA do que chega e considerado confiavel: o tipo declarado no data
 * URI e reconferido contra os bytes magicos, e o tamanho e limitado aqui.
 */

/** Versao grande, aberta no editor e na ampliacao (quadrada, ate 1000px). */
const MAX_IMAGE_BYTES = 512_000;
/** Miniatura de lista/PDV (200px) — cabe em qualquer linha de tabela. */
const MAX_THUMB_BYTES = 64_000;

const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Tipos raster aceitos. SVG fica de fora: e documento, e executa script. */
type ImageType = 'image/webp' | 'image/jpeg' | 'image/png';

/**
 * Identifica o formato pelos bytes iniciais do arquivo. E o que impede alguem
 * de declarar `image/png` e mandar HTML: a rota publica devolve o tipo apurado
 * aqui, nunca o que o cliente disse.
 */
function sniff(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer.subarray(1, 8).toString('latin1') === 'PNG\r\n\x1a\n'
  ) {
    return 'image/png';
  }
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function decode(value: string, field: string, maxBytes: number) {
  const match = DATA_URL.exec(value.trim());
  if (!match) {
    throw new BadRequestException(
      `Formato de imagem inválido em "${field}". Envie PNG, JPEG ou WebP.`,
    );
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    throw new BadRequestException(`Imagem vazia em "${field}".`);
  }
  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `Imagem grande demais em "${field}" (máximo ${Math.round(maxBytes / 1024)} KB).`,
    );
  }

  const actual = sniff(buffer);
  if (!actual) {
    throw new BadRequestException(`O arquivo enviado em "${field}" não é uma imagem.`);
  }
  if (actual !== match[1]) {
    // Tipo declarado != conteudo real. Pode ser bug do cliente, pode ser
    // tentativa de servir outra coisa com Content-Type de imagem.
    throw new BadRequestException(`Conteúdo de "${field}" não corresponde ao tipo declarado.`);
  }

  return { buffer, contentType: actual };
}

@Injectable()
export class ProductImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava (ou troca) a foto do produto. Cada gravacao gera um token novo. */
  async set(productId: string, input: { image: string; thumb: string }) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado.');

    const full = decode(input.image, 'foto', MAX_IMAGE_BYTES);
    const thumb = decode(input.thumb, 'miniatura', MAX_THUMB_BYTES);

    // So guardamos um `contentType`, entao as duas versoes precisam ser do
    // mesmo formato — do contrario a rota da miniatura anunciaria o tipo do
    // arquivo grande, e o header deixaria de descrever os bytes servidos. O
    // editor do navegador ja usa o mesmo codec nas duas, entao isto nunca
    // dispara em uso legitimo.
    if (full.contentType !== thumb.contentType) {
      throw new BadRequestException('Foto e miniatura precisam ser do mesmo formato.');
    }

    // Token novo a cada upload: a URL antiga (servida com cache imutavel)
    // simplesmente deixa de existir, entao ninguem fica com a foto velha.
    const token = randomBytes(16).toString('hex');

    const data = {
      token,
      contentType: full.contentType,
      data: full.buffer,
      thumb: thumb.buffer,
      byteSize: full.buffer.length + thumb.buffer.length,
    };

    const saved = await this.prisma.productImage.upsert({
      where: { productId },
      create: { productId, ...data },
      update: data,
      select: { token: true, byteSize: true },
    });

    return { token: saved.token, byteSize: saved.byteSize, ...photoUrls(saved.token) };
  }

  async remove(productId: string) {
    const existing = await this.prisma.productImage.findUnique({
      where: { productId },
      select: { id: true },
    });
    if (!existing) return { message: 'Produto já estava sem foto.' };

    await this.prisma.productImage.delete({ where: { productId } });
    return { message: 'Foto removida.' };
  }

  /** Bytes servidos pela rota publica. `variant` escolhe miniatura ou cheia. */
  async bytes(token: string, variant: 'full' | 'thumb') {
    const image = await this.prisma.productImage.findUnique({
      where: { token },
      select: { contentType: true, data: variant === 'full', thumb: variant === 'thumb' },
    });
    if (!image) throw new NotFoundException('Imagem não encontrada.');

    const buffer = variant === 'full' ? image.data : image.thumb;
    return { contentType: image.contentType, buffer: Buffer.from(buffer as Uint8Array) };
  }
}

/** URLs (relativas ao prefixo /api) das duas versoes da foto. */
export function photoUrls(token: string) {
  return {
    url: `/product-images/${token}`,
    thumbUrl: `/product-images/${token}/thumb`,
  };
}
