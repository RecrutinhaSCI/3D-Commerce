import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/cn';

/**
 * Markdown dos posts do Blog (GFM: tabelas, listas, links…).
 *
 * Segurança — o conteúdo vem do admin, mas mesmo assim:
 * - HTML embutido no texto é DESCARTADO (`skipHtml`; sem rehype-raw), então
 *   <script>, <iframe>, <style>, onerror=… nunca chegam ao DOM;
 * - `urlTransform` padrão do react-markdown remove esquemas perigosos
 *   (javascript:, vbscript:, data:…); só http(s), mailto, tel e caminhos
 *   relativos passam;
 * - imagens no Markdown são bloqueadas (a capa é gerenciada à parte);
 * - links externos abrem em nova aba com rel="noopener noreferrer nofollow";
 *   links internos (/loja, /categoria/…) navegam pela SPA.
 */
const components: Components = {
  h1: ({ children }) => <h2 className="mt-10 font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-10 font-display text-xl font-bold tracking-tight text-ink md:text-2xl">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-7 text-lg font-bold text-ink">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-6 font-bold text-ink">{children}</h4>,
  p: ({ children }) => <p className="mt-4 leading-relaxed text-ink-soft">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mt-4 list-disc space-y-1.5 pl-6 text-ink-soft marker:text-ink-mute">{children}</ul>,
  ol: ({ children }) => <ol className="mt-4 list-decimal space-y-1.5 pl-6 text-ink-soft marker:font-semibold marker:text-ink-mute">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed [&>p]:mt-0">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-5 border-l-4 border-accent/60 bg-bg-soft py-2 pl-4 pr-3 text-ink-soft [&>p]:mt-1">{children}</blockquote>
  ),
  hr: () => <hr className="my-10 border-ink-line" />,
  code: ({ children }) => (
    <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[0.9em] text-ink">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mt-4 overflow-x-auto rounded-xl bg-bg-soft p-4 text-sm [&>code]:bg-transparent [&>code]:p-0">{children}</pre>
  ),
  // Tabela rola na horizontal dentro do próprio bloco (mobile sem overflow da página).
  table: ({ children }) => (
    <div className="mt-5 overflow-x-auto rounded-xl border border-ink-line">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg-soft text-xs uppercase tracking-wide text-ink-mute">{children}</thead>,
  th: ({ children }) => <th className="border-b border-ink-line px-3 py-2.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-ink-line/60 px-3 py-2.5 align-top text-ink-soft">{children}</td>,
  a: ({ href, children }) => {
    const url = href ?? '';
    const cls = 'font-medium text-ink underline decoration-accent/60 underline-offset-2 hover:decoration-ink';
    if (url.startsWith('/') && !url.startsWith('//')) {
      return (
        <Link to={url} className={cls}>
          {children}
        </Link>
      );
    }
    if (url.startsWith('#')) return <a href={url} className={cls}>{children}</a>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
        {children}
      </a>
    );
  },
};

export function BlogMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('text-[15px] md:text-base', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        urlTransform={defaultUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
