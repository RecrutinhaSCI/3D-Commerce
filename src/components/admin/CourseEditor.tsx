import { useState, type FormEvent, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import slugify from 'slugify';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { CourseCard } from '@/components/blog/CourseCard';
import { courseService } from '@/services/courseService';
import { settingsService } from '@/services/settingsService';
import { ApiError } from '@/services/api';
import type { Course, CourseInput } from '@/types/course';
import { safeCourseUrl } from '@/utils/courses';

function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return <div className="min-w-0"><label htmlFor={`course-${name}`} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</label>{children}</div>;
}
const empty: CourseInput = {
  title: '', slug: '', eyebrow: '', description: '', shortDescription: '', coverImage: null,
  levelLabel: '', originalPrice: null, price: null, externalUrl: '', buttonLabel: 'Acessar curso',
  ctaType: 'external', featured: false, active: false, displayOrder: 0,
};
export function CourseEditor({ course, onClose, onSaved }: { course?: Course; onClose: () => void; onSaved: () => void }) {
  const initial: CourseInput = course ? {
    title: course.title, slug: course.slug, eyebrow: course.eyebrow, description: course.description,
    shortDescription: course.shortDescription, coverImage: course.coverImage, levelLabel: course.levelLabel,
    originalPrice: course.originalPrice, price: course.price, externalUrl: course.externalUrl,
    buttonLabel: course.buttonLabel, ctaType: course.ctaType, featured: course.featured,
    active: course.active, displayOrder: course.displayOrder,
  } : empty;
  const [draft, setDraft] = useState<CourseInput>(initial);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof CourseInput>(key: K, value: CourseInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  function close() {
    if (busy || uploading) return;
    if (JSON.stringify(draft) !== JSON.stringify(initial) && !window.confirm('Descartar alterações não salvas do curso?')) return;
    onClose();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || uploading) return;
    if (!safeCourseUrl(draft.externalUrl, draft.ctaType)) {
      toast.error(draft.ctaType === 'whatsapp' ? 'Informe um link válido do WhatsApp (https://wa.me/...).' : 'Informe uma URL http:// ou https:// válida.');
      return;
    }
    setBusy(true);
    try {
      const input = { ...draft, slug: draft.slug.trim() || slugify(draft.title, { lower: true, strict: true }) };
      if (course) await courseService.update(course.id, input);
      else await courseService.create(input);
      toast.success(course ? 'Curso atualizado.' : 'Curso criado.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível salvar o curso.');
    } finally { setBusy(false); }
  }
  const preview: Course = { ...draft, id: course?.id ?? 'preview', createdAt: course?.createdAt ?? '', updatedAt: course?.updatedAt ?? '' };
  return (
    <MotionConfig reducedMotion="user">
    <Modal open title={course ? 'Editar curso' : 'Novo curso'} maxWidth="max-w-5xl" onClose={close}>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={save}>
        <fieldset disabled={busy || uploading} className="min-w-0 space-y-4">
          <Field name="title" label="Título"><Input id="course-title" required minLength={3} maxLength={160} value={draft.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="slug" label="Slug"><Input id="course-slug" maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="Gerado pelo título" value={draft.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
            <Field name="eyebrow" label="Categoria curta"><Input id="course-eyebrow" maxLength={80} value={draft.eyebrow} onChange={(e) => set('eyebrow', e.target.value)} /></Field>
          </div>
          <Field name="short-description" label="Descrição curta"><Textarea id="course-short-description" maxLength={400} rows={3} value={draft.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} /></Field>
          <Field name="description" label="Descrição"><Textarea id="course-description" maxLength={10000} rows={5} value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <RemoteImageUploader label="Capa do curso" value={draft.coverImage} onUpload={async (file) => {
            setUploading(true);
            try { const { url } = await settingsService.uploadImage(file); set('coverImage', url); return url; }
            finally { setUploading(false); }
          }} onRemove={async () => set('coverImage', null)} hint="JPG, PNG ou WEBP. Prefira 16:9; a imagem inteira é preservada no card. A capa é vinculada ao salvar o curso." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="level" label="Nível"><Input id="course-level" maxLength={80} placeholder="Ex.: Iniciante" value={draft.levelLabel} onChange={(e) => set('levelLabel', e.target.value)} /></Field>
            <Field name="order" label="Ordem"><Input id="course-order" required type="number" min={0} step={1} value={draft.displayOrder} onChange={(e) => set('displayOrder', Number(e.target.value))} /></Field>
            <Field name="original-price" label="Preço original (opcional)"><Input id="course-original-price" type="number" min={0} step="0.01" value={draft.originalPrice ?? ''} onChange={(e) => set('originalPrice', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field name="price" label="Preço atual (opcional)"><Input id="course-price" type="number" min={0} step="0.01" value={draft.price ?? ''} onChange={(e) => set('price', e.target.value === '' ? null : Number(e.target.value))} /></Field>
          </div>
          <p className="text-xs text-ink-mute">Deixe o preço em branco para mentoria ou atendimento. Cursos direcionam ao link configurado.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="cta-type" label="Destino do botão"><Select id="course-cta-type" value={draft.ctaType} onChange={(e) => set('ctaType', e.target.value as CourseInput['ctaType'])}><option value="external">Site externo</option><option value="whatsapp">WhatsApp</option></Select></Field>
            <Field name="button-label" label="Texto do botão"><Input id="course-button-label" required maxLength={80} value={draft.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} /></Field>
          </div>
          <Field name="external-url" label="URL de destino"><Input id="course-external-url" required type="url" maxLength={2000} placeholder="https://..." value={draft.externalUrl} onChange={(e) => set('externalUrl', e.target.value)} /></Field>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} className="accent-ink" /> Ativo no site</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.featured} onChange={(e) => set('featured', e.target.checked)} className="accent-ink" /> Destaque</label>
          </div>
          <div className="flex justify-end gap-2 border-t border-ink-line pt-4">
            <Button type="button" variant="secondary" onClick={close}>Cancelar</Button>
            <Button type="submit" loading={busy}>Salvar curso</Button>
          </div>
        </fieldset>
      </form>
      <aside className="min-w-0"><h3 className="mb-3 text-sm font-bold">Preview do card</h3><CourseCard course={preview} preview /></aside>
      </div>
    </Modal>
    </MotionConfig>
  );
}
