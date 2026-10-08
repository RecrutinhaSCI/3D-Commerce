import { useRef, useState } from 'react';
import { ImagePlus, Link as LinkIcon, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Input } from '@/components/ui/Input';
import { COMPRESSIBLE_IMAGE_TYPES, compressImageForUpload } from '@/utils/imageCompress';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_BYTES = 1 * 1024 * 1024; // 1 MB

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

interface BaseProps {
  label?: string;
  /** Texto pequeno explicativo abaixo do campo */
  hint?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (next: string) => void;
}

interface MultipleProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}

type Props = SingleProps | MultipleProps;

/**
 * Upload mockado de imagens (FileReader → Base64 → store/localStorage).
 *
 * IMPORTANTE: armazenamento local apenas. Em produção, trocar por
 * upload real (ex.: Supabase Storage) para evitar estourar o localStorage.
 */
export function ImageUploader(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlValue, setUrlValue] = useState('');

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const valid: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!ACCEPTED.includes(f.type)) {
        toast.error(`${f.name}: formato não suportado.`);
        continue;
      }
      // Foto grande é reduzida aqui (vira Base64 e é gravada como texto, então
      // precisa ficar abaixo de 1 MB). SVG não é reduzido.
      let file = f;
      if (COMPRESSIBLE_IMAGE_TYPES.includes(f.type) && f.size > MAX_BYTES) {
        try {
          file = await compressImageForUpload(f, 1600, MAX_BYTES * 0.9);
        } catch (err) {
          toast.error(`${f.name}: ${err instanceof Error ? err.message : 'não foi possível reduzir a imagem.'}`);
          continue;
        }
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${f.name}: imagem acima de 1MB.`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        valid.push(dataUrl);
      } catch {
        toast.error(`${f.name}: erro ao ler arquivo.`);
      }
    }
    if (valid.length === 0) return;

    if (props.multiple) {
      const max = props.max ?? 6;
      const next = [...props.value, ...valid].slice(0, max);
      props.onChange(next);
      toast.success(`${valid.length} imagem(ns) adicionada(s).`);
    } else {
      props.onChange(valid[0]);
      toast.success('Imagem atualizada.');
    }
  }

  function addUrl() {
    const v = urlValue.trim();
    if (!v) return;
    if (props.multiple) {
      const max = props.max ?? 6;
      props.onChange([...props.value, v].slice(0, max));
    } else {
      props.onChange(v);
    }
    setUrlValue('');
    setShowUrlForm(false);
    toast.success('Imagem adicionada via URL.');
  }

  function removeAt(idx: number) {
    if (props.multiple) {
      props.onChange(props.value.filter((_, i) => i !== idx));
    } else {
      props.onChange('');
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
          {items.map((src, i) => (
            <div
              key={i}
              className={`group relative aspect-square overflow-hidden rounded-xl border ${
                props.multiple && i === 0
                  ? 'border-ink ring-2 ring-ink/15'
                  : 'border-ink-line'
              }`}
            >
              <img src={src} alt={`Imagem ${i + 1}`} className="h-full w-full object-cover" />
              {props.multiple && i === 0 && (
                <span className="absolute left-1 top-1 rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-bg">
                  Principal
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink/80 text-bg opacity-0 transition group-hover:opacity-100"
                aria-label="Remover imagem"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-secondary !py-2 !text-xs"
        >
          <Upload className="h-3.5 w-3.5" />
          {items.length === 0 ? 'Enviar imagem' : 'Adicionar mais'}
        </button>
        <button
          type="button"
          onClick={() => setShowUrlForm((v) => !v)}
          className="btn-ghost !py-2 !text-xs"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Usar URL
        </button>
        {items.length === 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
            <ImagePlus className="h-3 w-3" /> PNG, JPG ou WEBP (reduzidas automaticamente) ou SVG até 1MB
          </span>
        )}
      </div>

      {showUrlForm && (
        <div className="flex gap-2">
          <Input
            placeholder="https://..."
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
          />
          <button type="button" onClick={addUrl} className="btn-primary !py-2 !text-xs">
            Adicionar
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
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
