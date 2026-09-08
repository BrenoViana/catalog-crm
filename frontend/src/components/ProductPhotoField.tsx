import './ProductPhotoField.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CROP,
  ImageError,
  clampCrop,
  drawSquare,
  encodePhoto,
  formatBytes,
  prepareSource,
  readImage,
  type CropView,
} from '../lib/image';
import { IconCamera, IconRotate, IconTrash, IconUpload, IconZoom } from './ui-icons';

/**
 * O que o formulário deve fazer com a foto ao salvar. É um rascunho: nada vai
 * para o servidor enquanto o usuário não salvar o produto — assim "Cancelar"
 * cancela a foto junto, como ele espera.
 */
export type PhotoDraft =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'set'; image: string; thumb: string; byteSize: number };

interface Props {
  /** Foto já salva no produto (URL absoluta), quando existe. */
  currentUrl: string | null;
  value: PhotoDraft;
  onChange: (draft: PhotoDraft) => void;
  disabled?: boolean;
}

/** Lado do quadrado de prévia, em pixels de imagem (o CSS controla o tamanho). */
const PREVIEW_PX = 640;

/**
 * Campo de foto do produto: soltar, colar, escolher arquivo ou fotografar, e
 * enquadrar num quadrado antes de salvar.
 *
 * O recorte quadrado é uma decisão de produto, não uma limitação: no balcão a
 * foto é lida de relance, e uma grade em que cada item tem proporção diferente
 * obriga o olho a reprocessar cada célula. Com o quadrado fixo, a lista, a
 * grade e o PDV ficam com o mesmo ritmo, e o operador acha o item pela forma e
 * pela cor antes de ler o nome.
 */
export function ProductPhotoField({ currentUrl, value, onChange, disabled }: Props) {
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [original, setOriginal] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState<CropView>(DEFAULT_CROP);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; view: CropView } | null>(null);

  const editing = source !== null;

  // ------------------------------------------------------------- carregar
  const load = useCallback(async (file: Blob) => {
    setError('');
    setBusy(true);
    try {
      const img = await readImage(file);
      setOriginal(img);
      setSource(prepareSource(img, 0));
      setView(DEFAULT_CROP);
    } catch (e) {
      setError(e instanceof ImageError ? e.message : 'Não foi possível abrir a imagem.');
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Colar (Ctrl+V) é o caminho mais rápido quando a foto veio do catálogo do
   * fornecedor ou de uma conversa. O ouvinte é global porque a área de colagem
   * precisa valer para o modal inteiro, mas ignora colagens feitas dentro de um
   * campo de texto — lá, colar continua sendo colar texto.
   */
  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const item = Array.from(event.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void load(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [disabled, load]);

  // --------------------------------------------------------------- prévia
  useEffect(() => {
    if (!source || !canvasRef.current) return;
    drawSquare(source, view, PREVIEW_PX, canvasRef.current);
  }, [source, view]);

  /**
   * A roda do mouse aproxima. Precisa de listener manual porque o React
   * registra `onWheel` como passivo e `preventDefault()` seria ignorado — sem
   * isso, dar zoom na foto rolaria o modal atrás.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((v) => clampCrop(source, { ...v, scale: v.scale * (event.deltaY < 0 ? 1.12 : 0.89) }));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [source]);

  const move = (dx: number, dy: number) => {
    if (!source) return;
    setView((v) => clampCrop(source, { ...v, offsetX: v.offsetX + dx, offsetY: v.offsetY + dy }));
  };

  const zoom = (factor: number) => {
    if (!source) return;
    setView((v) => clampCrop(source, { ...v, scale: v.scale * factor }));
  };

  const rotate = () => {
    if (!original) return;
    const rotation = (view.rotation + 90) % 360;
    const rotated = prepareSource(original, rotation);
    setSource(rotated);
    // O giro reenquadra: manter o deslocamento antigo jogaria o assunto para
    // fora do quadrado. Centraliza mantendo só a aproximação.
    setView(clampCrop(rotated, { ...DEFAULT_CROP, scale: view.scale, rotation }));
  };

  // --------------------------------------------------------------- aplicar
  const apply = async () => {
    if (!source) return;
    setBusy(true);
    setError('');
    try {
      const photo = await encodePhoto(source, view);
      onChange({ kind: 'set', ...photo });
      setSource(null);
      setOriginal(null);
    } catch (e) {
      setError(e instanceof ImageError ? e.message : 'Não foi possível processar a imagem.');
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setSource(null);
    setOriginal(null);
    setError('');
  };

  // ---------------------------------------------------------- estado atual
  const draftUrl = value.kind === 'set' ? value.image : null;
  const shownUrl = value.kind === 'remove' ? null : (draftUrl ?? currentUrl);
  const hasPhoto = Boolean(shownUrl);

  const pick = (input: HTMLInputElement | null) => {
    setError('');
    input?.click();
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Zera o valor para que escolher o MESMO arquivo de novo continue disparando
    // o evento (o navegador não dispara change quando o valor não muda).
    event.target.value = '';
    if (file) void load(file);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (file) void load(file);
    else setError('Solte um arquivo de imagem (PNG, JPEG ou WebP).');
  };

  return (
    <div className="photo-field" ref={rootRef}>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={onFile}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={onFile}
      />

      {editing ? (
        <div className="photo-editor">
          <div className="photo-stage">
            <canvas
              ref={canvasRef}
              className="photo-canvas"
              role="application"
              aria-label="Enquadrar a foto: arraste para mover, use as setas do teclado e os botões de zoom"
              tabIndex={0}
              onPointerDown={(e) => {
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, view };
              }}
              onPointerMove={(e) => {
                const start = drag.current;
                if (!start || !source) return;
                const side = e.currentTarget.clientWidth || 1;
                setView(
                  clampCrop(source, {
                    ...start.view,
                    offsetX: start.view.offsetX + (e.clientX - start.x) / side,
                    offsetY: start.view.offsetY + (e.clientY - start.y) / side,
                  }),
                );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.08 : 0.02;
                if (e.key === 'ArrowLeft') move(step, 0);
                else if (e.key === 'ArrowRight') move(-step, 0);
                else if (e.key === 'ArrowUp') move(0, step);
                else if (e.key === 'ArrowDown') move(0, -step);
                else if (e.key === '+' || e.key === '=') zoom(1.12);
                else if (e.key === '-' || e.key === '_') zoom(0.89);
                else return;
                e.preventDefault();
              }}
            />
            <span className="photo-guides" aria-hidden="true" />
          </div>

          <div className="photo-tools">
            <label className="photo-zoom">
              <span className="sr-only">Aproximação</span>
              <IconZoom />
              <input
                type="range"
                min={1}
                max={4}
                step={0.01}
                value={view.scale}
                onChange={(e) =>
                  source && setView(clampCrop(source, { ...view, scale: Number(e.target.value) }))
                }
              />
            </label>
            <button type="button" className="mini-button with-icon" onClick={rotate}>
              <IconRotate />
              Girar
            </button>
          </div>

          <p className="photo-hint">
            Arraste a foto para enquadrar. O que estiver dentro do quadrado é o que será salvo.
          </p>

          {error ? <div className="error-message">{error}</div> : null}

          <div className="photo-actions">
            <button type="button" className="ghost-button" onClick={cancelEdit} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="primary-button" onClick={apply} disabled={busy}>
              {busy ? 'Processando…' : 'Aplicar foto'}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`photo-drop ${dragging ? 'is-dragging' : ''} ${hasPhoto ? 'has-photo' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="photo-preview">
            {shownUrl ? (
              <img src={shownUrl} alt="Foto do produto" />
            ) : (
              <span className="photo-placeholder" aria-hidden="true">
                <IconCamera size={26} />
              </span>
            )}
          </div>

          <div className="photo-side">
            <strong className="photo-title">
              {hasPhoto ? 'Foto do produto' : 'Sem foto'}
            </strong>
            <p className="photo-hint">
              {hasPhoto
                ? 'É esta imagem que identifica o item na lista e no PDV.'
                : 'Arraste uma imagem aqui, cole com Ctrl+V ou escolha um arquivo.'}
            </p>

            {busy ? <p className="photo-hint">Abrindo imagem…</p> : null}
            {error ? <div className="error-message">{error}</div> : null}
            {value.kind === 'set' ? (
              <p className="photo-meta">
                Nova foto pronta · {formatBytes(value.byteSize)} — salve o produto para valer.
              </p>
            ) : null}
            {value.kind === 'remove' ? (
              <p className="photo-meta">A foto será removida ao salvar.</p>
            ) : null}

            <div className="photo-actions">
              <button
                type="button"
                className="ghost-button with-icon"
                onClick={() => pick(fileRef.current)}
                disabled={disabled || busy}
              >
                <IconUpload />
                {hasPhoto ? 'Trocar' : 'Escolher arquivo'}
              </button>
              <button
                type="button"
                className="ghost-button with-icon photo-camera"
                onClick={() => pick(cameraRef.current)}
                disabled={disabled || busy}
              >
                <IconCamera />
                Câmera
              </button>
              {hasPhoto ? (
                <button
                  type="button"
                  className="mini-button danger with-icon"
                  onClick={() => onChange(currentUrl ? { kind: 'remove' } : { kind: 'keep' })}
                  disabled={disabled || busy}
                >
                  <IconTrash />
                  Remover
                </button>
              ) : null}
              {value.kind !== 'keep' ? (
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => onChange({ kind: 'keep' })}
                  disabled={disabled || busy}
                >
                  Desfazer
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
