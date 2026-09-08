import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Foto enviada pelo navegador, ja recortada em quadrado e recomprimida, em duas
 * versoes. Os limites aqui sao do TEXTO base64 (~4/3 do binario); o limite real
 * de bytes, o tipo aceito e a conferencia dos bytes magicos ficam no
 * ProductImagesService, que e quem decodifica.
 */
export class SetProductImageDto {
  /** Versao de exibicao (ate 1000px). */
  @IsString()
  @MinLength(32)
  @MaxLength(700_000, { message: 'Foto muito grande.' })
  image: string;

  /** Miniatura de lista e PDV (200px). */
  @IsString()
  @MinLength(32)
  @MaxLength(96_000, { message: 'Miniatura muito grande.' })
  thumb: string;
}
