import './ProductThumb.css';
import { useState } from 'react';
import { assetUrl, type Product } from '../lib/api-client';

/** O suficiente para desenhar a miniatura — serve para qualquer lista. */
export type ThumbProduct = Pick<Product, 'name'> &
  Partial<Pick<Product, 'photo' | 'imageUrl' | 'sku'>>;

interface Props {
  product: ThumbProduct;
  /** sm: linha de tabela · md: PDV e carrinho · lg/xl: cartão e editor. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * Endereço da foto do produto, na ordem de precedência: a foto carregada na
 * loja e, na falta dela, a URL externa que veio da importação.
 */
export function productPhotoUrl(product: ThumbProduct, variant: 'thumb' | 'full' = 'thumb') {
  const own = variant === 'thumb' ? product.photo?.thumbUrl : product.photo?.url;
  if (own) return assetUrl(own);

  // Defesa em profundidade sobre a reserva externa: o servidor já só aceita
  // https, mas um registro antigo (o campo existe desde o início) pode ter
  // qualquer coisa gravada. Endereço não-https simplesmente não vira imagem.
  const external = product.imageUrl ?? null;
  if (external && !/^https:\/\//i.test(external)) return null;
  return assetUrl(external);
}

/** Iniciais da primeira e da última palavra do nome (ignora "de", "da"…). */
function initials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const list = words.length > 0 ? words : name.trim().split(/\s+/);
  const first = list[0]?.[0] ?? '?';
  const last = list.length > 1 ? list[list.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Cor estável derivada do nome. Não é enfeite: dois produtos parecidos ("Coca
 * 350" e "Coca 600") ficam com cores diferentes, então mesmo sem foto a lista
 * continua tendo âncora visual. Luminosidade em 30% para as iniciais brancas
 * passarem contraste AA.
 */
function fallbackColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 45% 30%)`;
}

/**
 * Miniatura quadrada do produto, com reserva desenhada quando não há foto.
 *
 * Vai com `referrerPolicy="no-referrer"`: a reserva `imageUrl` pode apontar para
 * um host de terceiro (veio de importação) e, sem isso, cada linha da lista
 * contaria a esse host qual endereço da loja está aberto.
 *
 * A reserva é sempre do mesmo tamanho da foto: a linha da tabela e o cartão da
 * grade não mudam de altura conforme o catálogo vai sendo fotografado, e não
 * existe "pulo" de layout enquanto as imagens carregam.
 */
export function ProductThumb({ product, size = 'sm', className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const url = productPhotoUrl(product);

  return (
    <span className={`product-thumb is-${size} ${className}`.trim()}>
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="product-thumb-fallback"
          style={{ background: fallbackColor(product.name) }}
          aria-hidden="true"
        >
          {initials(product.name)}
        </span>
      )}
    </span>
  );
}
