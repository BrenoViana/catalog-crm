import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProductImagesService } from './product-images.service';
import { ProductImageRateLimitGuard } from './product-images-rate-limit.guard';
import { Public } from '../common/public.decorator';

/**
 * Entrega os bytes da foto do produto.
 *
 * A rota e PUBLICA por necessidade tecnica: `<img src>` nao manda o header
 * Authorization, e o token do app vive em localStorage — nao ha cookie de
 * sessao para o navegador anexar sozinho. O que protege aqui e o endereco:
 * `token` sao 16 bytes aleatorios, sem relacao com o id do produto, e nao ha
 * rota que liste tokens sem autenticacao. O conteudo exposto e uma foto de
 * vitrine, sem dado pessoal.
 *
 * Como o token muda a cada upload, a resposta pode ser cacheada como imutavel:
 * trocar a foto gera uma URL nova em vez de precisar invalidar a antiga.
 */
@Controller('product-images')
@UseGuards(ProductImageRateLimitGuard)
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Public()
  @Get(':token')
  full(
    @Param('token') token: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    return this.send(token, 'full', ifNoneMatch, res);
  }

  @Public()
  @Get(':token/thumb')
  thumb(
    @Param('token') token: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    return this.send(token, 'thumb', ifNoneMatch, res);
  }

  private async send(
    token: string,
    variant: 'full' | 'thumb',
    ifNoneMatch: string | undefined,
    res: Response,
  ) {
    // Token e sempre hex de 32 caracteres: qualquer outra coisa nem chega ao
    // banco (e nao vira consulta com entrada arbitraria).
    if (!/^[0-9a-f]{32}$/.test(token)) throw new NotFoundException('Imagem não encontrada.');

    const etag = `"${token}-${variant}"`;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    // O helmet marca todo recurso como same-origin; a imagem precisa ser lida
    // pelo frontend, que roda em outra origem (5173 em desenvolvimento).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // Revalidacao respondida ANTES de tocar o banco. Como escrevemos a resposta
    // com res.end(), o Express nao compara o ETag sozinho — sem esta conferencia
    // o cabecalho seria decorativo e cada revalidacao retransmitiria os bytes
    // inteiros, consumindo uma conexao do pool que o checkout precisa.
    if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
      res.status(304).end();
      return;
    }

    const { contentType, buffer } = await this.images.bytes(token, variant);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', 'inline');
    res.end(buffer);
  }
}

/**
 * If-None-Match e uma lista separada por virgula, e um proxy pode ter marcado a
 * entrada como fraca (`W/"..."`). Compara so o valor, ignorando o prefixo.
 */
function matchesEtag(header: string, etag: string) {
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .includes(etag);
}
