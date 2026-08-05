/**
 * Uploader que sobe arquivos DIRETO para um endpoint do backend.
 * Diferente do `ImageUploader` legado que salvava Base64 no store.
 *
 * Uso: passa `onUpload(file) => Promise<string>` que retorna a URL final,
 * e o componente lida com o preview local + estado de loading.
 */
import { useRef, useState } from 'react';
import { ImagePlus, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiAssetUrl } from '@/services/api';

interface BaseProps {
  label?: string;
  hint?: string;
  /** Tamanho máximo em bytes (default 5MB, ou 8MB quando `allowVideo`). */
  maxBytes?: number;
  /** Limite máximo específico para vídeos (default 8MB). Só usado com `allowVideo`. */
  maxVideoBytes?: number;
  /** Mimes permitidos (default: JPG/PNG/WEBP; se `allowVideo`: + GIF + MP4). */
  accept?: string[];
  /** R20 — Habilita GIF + MP4 além das imagens tradicionais. */
  allowVideo?: boolean;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null;
  /** Sobe 1 arquivo e devolve a URL final salva no backend. */
  onUpload: (file: File) => Promise<string>;
  /** Chamado ao remover imagem (opcional; se ausente, só limpa localmente). */
  onRemove?: () => Promise<void> | void;
}

interface MultipleProps extends BaseProps {
  multiple: true;
  /** Lista atual de URLs já persistidas no backend. */
  value: string[];
  /** R20 — tipos correspondentes a `value`. Se ausente, é inferido pela URL. */
  mediaTypes?: Array<'image' | 'video'>;
  /** Sobe N arquivos de uma vez e devolve a lista final. */
  onUploadMany: (files: File[]) => Promise<string[]>;
  onRemoveAt?: (index: number) => Promise<void> | void;
  max?: number;
}

type Props = SingleProps | MultipleProps;

const DEFAULT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_ACCEPT_MEDIA = [...DEFAULT_ACCEPT, 'image/gif', 'video/mp4'];
const DEFAULT_MAX = 5 * 1024 * 1024;
const DEFAULT_MAX_VIDEO = 8 * 1024 * 1024;

function isVideoUrl(u: string): boolean {
  return /\.mp4($|\?)/i.test(u);
}

export function RemoteImageUploader(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const accept = props.accept ?? (props.allowVideo ? DEFAULT_ACCEPT_MEDIA : DEFAULT_ACCEPT);
  const maxBytes = props.maxBytes ?? DEFAULT_MAX;
  const maxVideoBytes = props.maxVideoBytes ?? DEFAULT_MAX_VIDEO;

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!accept.includes(f.type)) {
        toast.error(`${f.name}: formato não suportado.`);
        continue;
      }
      // Limite por tipo: vídeo pode ser um pouco maior que imagem, respeitando
      // exatamente o que o backend valida em products.service.
      const limit = f.type.startsWith('video/') ? maxVideoBytes : maxBytes;
      if (f.size > limit) {
        toast.error(`${f.name}: acima de ${Math.round(limit / (1024 * 1024))}MB.`);
        continue;
      }
      files.push(f);
    }
    if (files.length === 0) return;

    setBusy(true);
    try {
      if (props.multiple) {
        await props.onUploadMany(files);
        toast.success(`${files.length} imagem(ns) enviada(s).`);
      } else {
        await props.onUpload(files[0]);
        toast.success('Imagem enviada.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(idx?: number) {
    if (busy) return;
    setBusy(true);
    try {
      if (props.multiple && typeof idx === 'number') {
        await props.onRemoveAt?.(idx);
      } else if (!props.multiple) {
        await props.onRemove?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover.');
    } finally {
      setBusy(false);
    }
  }

  const items: string[] = props.multiple ? props.value : props.value ? [props.value] : [];

  return (
    <div className="space-y-3">
      {props.label && (
        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">{props.label}</p>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((src, i) => {
            const resolved = apiAssetUrl(src) || src;
            // Tipo vem do backend quando informado; senão inferimos pela URL.
            const declaredType = props.multiple ? props.mediaTypes?.[i] : undefined;
            const isVideo = declaredType === 'video' || (!declaredType && isVideoUrl(resolved));
            return (
              <div
                key={`${src}-${i}`}
                className={`group relative aspect-square overflow-hidden rounded-xl border ${
                  props.multiple && i === 0
                    ? 'border-ink ring-2 ring-ink/15'
                    : 'border-ink-line'
                }`}
              >
                {isVideo ? (
                  <video
                    src={resolved}
                    muted
                    playsInline
                    // Só metadados: evita puxar o vídeo inteiro no admin.
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img src={resolved} alt="" className="h-full w-full object-cover" />
                )}
                {props.multiple && i === 0 && (
                  <span className="absolute left-1 top-1 rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bg">
                    Principal
                  </span>
                )}
                {isVideo && (
                  <span className="absolute bottom-1 left-1 rounded-md bg-ink/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bg">
                    Vídeo
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  disabled={busy}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-bg opacity-0 transition group-hover:opacity-100 disabled:opacity-40"
                  aria-label={isVideo ? 'Remover vídeo' : 'Remover imagem'}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn-secondary !py-2 !text-xs disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {busy ? 'Enviando...' : items.length === 0 ? 'Enviar imagem' : 'Adicionar mais'}
        </button>
        {items.length === 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
            <ImagePlus className="h-3 w-3" />
            {props.allowVideo
              ? `JPG, PNG, WEBP, GIF (até ${Math.round(maxBytes / (1024 * 1024))}MB) ou MP4 (até ${Math.round(maxVideoBytes / (1024 * 1024))}MB)`
              : `JPG, PNG ou WEBP · até ${Math.round(maxBytes / (1024 * 1024))}MB`}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple={!!props.multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {props.hint && <p className="text-[11px] text-ink-mute">{props.hint}</p>}
    </div>
  );
}
