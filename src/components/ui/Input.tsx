import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

const base =
  'w-full rounded-xl border border-ink-line bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-mute transition focus:border-ink focus:outline-none';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { error?: string }>(
  function Input({ className, error, ...rest }, ref) {
    return (
      <>
        <input ref={ref} className={cn(base, error && 'border-rose-400', className)} {...rest} />
        {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
      </>
    );
  },
);

/** Campo de senha com o botão de olho para mostrar/ocultar o que foi digitado. */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { error?: string }
>(function PasswordInput({ className, error, ...rest }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      {/* Wrapper próprio: o botão centraliza no input mesmo com a mensagem de erro abaixo. */}
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn(base, 'pr-11', error && 'border-rose-400', className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-mute transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
    </>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }>(
  function Textarea({ className, error, ...rest }, ref) {
    return (
      <>
        <textarea ref={ref} className={cn(base, 'min-h-[110px]', error && 'border-rose-400', className)} {...rest} />
        {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
      </>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { error?: string }>(
  function Select({ className, error, children, ...rest }, ref) {
    return (
      <>
        <select ref={ref} className={cn(base, 'pr-10', error && 'border-rose-400', className)} {...rest}>
          {children}
        </select>
        {error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
      </>
    );
  },
);

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft', className)}>
      {children}
    </label>
  );
}
