import { useAdminDataStore } from '@/store/useAdminDataStore';
import { site } from '@/config/site';
import { useSEO } from '@/utils/seo';

export default function PrivacyPolicy() {
  useSEO('Política de Privacidade');
  const settings = useAdminDataStore((s) => s.settings);

  const storeName = settings.name || site.name;
  const email = settings.email || site.email;
  const address = settings.address || site.address;
  const cnpj = settings.cnpj || site.cnpj;
  const updatedAt = '15 de setembro de 2026';

  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Política</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Política de Privacidade</h1>
        <p className="mt-3 text-ink-mute">
          A {storeName} respeita a sua privacidade e trata seus dados pessoais de acordo com a
          Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD).
        </p>
        <p className="mt-1 text-xs text-ink-mute">Última atualização: {updatedAt}.</p>
      </header>

      <div className="prose prose-sm mt-10 max-w-3xl text-ink-soft">
        <h2 className="text-lg font-bold text-ink">1. Controlador dos dados</h2>
        <p>
          O controlador responsável pelo tratamento dos seus dados é a <strong>{storeName}</strong>
          {cnpj ? <>, inscrita no CNPJ {cnpj}</> : null}, com endereço em {address}. Para exercer
          seus direitos ou tirar dúvidas sobre privacidade, entre em contato pelo e-mail{' '}
          <a href={`mailto:${email}`} className="text-ink underline">{email}</a> ou pelo WhatsApp{' '}
          {site.whatsappDisplay}.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">2. Quais dados coletamos</h2>
        <ul>
          <li><strong>Dados cadastrais:</strong> nome completo, e-mail, telefone/WhatsApp e senha (armazenada de forma protegida).</li>
          <li><strong>Dados fiscais:</strong> CPF, necessário para emissão de nota fiscal.</li>
          <li><strong>Endereço:</strong> CEP, rua, número, complemento, bairro, cidade e estado, para entrega dos pedidos.</li>
          <li>
            <strong>Dados de pagamento:</strong> os dados do cartão são coletados e
            <strong> tokenizados diretamente pelo Mercado Pago</strong>, nosso processador de
            pagamentos. A {storeName} <strong>não</strong> armazena o número completo do cartão nem
            o código de segurança em seus servidores.
          </li>
          <li><strong>Dados de navegação:</strong> cookies e informações técnicas necessárias para o funcionamento do carrinho e da experiência de compra.</li>
        </ul>

        <h2 className="mt-6 text-lg font-bold text-ink">3. Finalidade do tratamento</h2>
        <ul>
          <li>Processar e entregar seus pedidos e emitir nota fiscal.</li>
          <li>Gerenciar sua conta e o histórico de compras.</li>
          <li>Prestar atendimento e suporte técnico.</li>
          <li>Prevenir fraudes e garantir a segurança das transações.</li>
          <li>Enviar comunicações relevantes sobre pedidos e, mediante consentimento, novidades e ofertas.</li>
        </ul>
        <p>Não vendemos nem cedemos seus dados a terceiros para fins de marketing.</p>

        <h2 className="mt-6 text-lg font-bold text-ink">4. Base legal</h2>
        <p>
          Tratamos seus dados com fundamento nas seguintes bases legais da LGPD (art. 7º):
          <strong> execução de contrato</strong> (processar sua compra), <strong>cumprimento de
          obrigação legal</strong> (emissão fiscal e guarda de documentos), <strong>legítimo
          interesse</strong> (segurança e prevenção a fraudes) e <strong>consentimento</strong>
          (comunicações de marketing e cookies não essenciais).
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">5. Compartilhamento com operadores</h2>
        <p>
          Compartilhamos dados apenas com parceiros necessários para a operação, na qualidade de
          operadores: <strong>Mercado Pago</strong> (processamento de pagamentos), transportadoras e
          Correios (entrega) e provedores de infraestrutura/e-mail. Cada parceiro trata os dados
          somente para a finalidade contratada.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">6. Cookies</h2>
        <p>
          Utilizamos cookies essenciais para o funcionamento do carrinho, login e checkout. Cookies
          não essenciais (analíticos ou de marketing) dependem do seu consentimento, coletado pelo
          aviso exibido ao acessar o site.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">7. Retenção dos dados</h2>
        <p>
          Mantemos seus dados enquanto sua conta estiver ativa e pelos prazos exigidos por lei
          (por exemplo, dados fiscais por até 5 anos). Após esses prazos, os dados são eliminados ou
          anonimizados de forma segura.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">8. Seus direitos como titular</h2>
        <p>Nos termos do art. 18 da LGPD, você pode a qualquer momento solicitar:</p>
        <ul>
          <li>Confirmação da existência de tratamento e <strong>acesso</strong> aos seus dados.</li>
          <li><strong>Correção</strong> de dados incompletos, inexatos ou desatualizados.</li>
          <li><strong>Exclusão</strong> ou anonimização dos dados tratados com base no consentimento.</li>
          <li><strong>Portabilidade</strong> e exportação dos seus dados.</li>
          <li>Revogação do consentimento e informação sobre com quem os dados foram compartilhados.</li>
        </ul>
        <p>
          Para exercer qualquer desses direitos, escreva para{' '}
          <a href={`mailto:${email}`} className="text-ink underline">{email}</a>. Responderemos no
          menor prazo possível.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">9. Segurança</h2>
        <p>
          Adotamos medidas técnicas e organizacionais para proteger seus dados, incluindo conexões
          criptografadas (HTTPS), controle de acesso e tokenização dos dados de pagamento pelo
          Mercado Pago.
        </p>

        <h2 className="mt-6 text-lg font-bold text-ink">10. Alterações desta política</h2>
        <p>
          Esta política pode ser atualizada para refletir mudanças legais ou operacionais. A data da
          última atualização é sempre indicada no topo desta página.
        </p>
      </div>
    </div>
  );
}
