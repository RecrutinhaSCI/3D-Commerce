import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { MotionConfig } from 'framer-motion';
import toast from 'react-hot-toast';
import { courseService } from '@/services/courseService';
import { ApiError } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CourseEditor } from './CourseEditor';
import { sortCourses } from '@/utils/courses';
import { formatBRL } from '@/utils/price';
import type { Course } from '@/types/course';

export function CoursesManager() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<Course | 'new' | null>(null);
  const [removing, setRemoving] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setState('loading');
    try { const { courses: data } = await courseService.listAdmin(); setCourses(sortCourses(data)); setState('ready'); }
    catch { setState('error'); }
  }
  useEffect(() => {
    let cancelled = false;
    courseService.listAdmin().then(({ courses: data }) => {
      if (!cancelled) { setCourses(sortCourses(data)); setState('ready'); }
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);
  async function remove() {
    if (!removing || busy) return;
    setBusy(true);
    try { await courseService.remove(removing.id); setRemoving(null); toast.success('Curso excluído.'); await load(); }
    catch (err) { toast.error(err instanceof ApiError ? err.message : 'Não foi possível excluir o curso.'); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="admin-courses-title" className="mb-10">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 id="admin-courses-title" className="text-xl font-bold">Cursos</h2><p className="mt-1 text-sm text-ink-mute">Cadastre cursos e mentorias com link externo ou WhatsApp.</p></div><Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Novo curso</Button></header>
    {state === 'loading' ? <p role="status" className="text-sm text-ink-mute">Carregando cursos...</p> : state === 'error' ? <div role="alert" className="card p-5"><p className="mb-3 text-sm">Não foi possível carregar os cursos.</p><Button size="sm" onClick={load}>Tentar novamente</Button></div> : courses.length ?
      <ul className="card divide-y divide-ink-line">{courses.map((course) => <li key={course.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 flex-1"><p className="break-words font-semibold">{course.title}</p><p className="mt-1 text-xs text-ink-mute">{course.active ? 'Ativo' : 'Inativo'} · Ordem {course.displayOrder}{course.featured ? ' · Destaque' : ''} · {course.price === null ? 'Sem preço' : formatBRL(course.price)}</p></div>
        <div className="flex shrink-0 gap-2"><Button variant="secondary" size="sm" aria-label={`Editar ${course.title}`} onClick={() => setEditing(course)}><Edit className="h-4 w-4" /> Editar</Button><Button variant="ghost" size="sm" aria-label={`Excluir ${course.title}`} onClick={() => setRemoving(course)}><Trash2 className="h-4 w-4" /></Button></div>
      </li>)}</ul> : <p className="card p-5 text-sm text-ink-mute">Nenhum curso cadastrado. Crie o primeiro quando estiver pronto para publicar.</p>}
    {editing && <CourseEditor key={editing === 'new' ? 'new' : editing.id} course={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    <MotionConfig reducedMotion="user"><Modal open={!!removing} onClose={() => { if (!busy) setRemoving(null); }} title="Excluir curso?">
      <p className="text-sm text-ink-mute">Excluir “{removing?.title}” definitivamente? Para apenas ocultar, edite o curso e desmarque Ativo no site.</p>
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="danger" loading={busy} onClick={remove}>Excluir curso</Button></div>
    </Modal></MotionConfig>
  </section>;
}
