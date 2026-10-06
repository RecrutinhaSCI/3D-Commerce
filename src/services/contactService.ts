import { api } from './api';

export type ContactMessageStatus = 'NEW' | 'READ' | 'ANSWERED' | 'ARCHIVED';

export interface ApiContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: ContactMessageStatus;
  createdAt: string;
}

export interface ApiNewsletterSubscriber {
  id: string;
  email: string;
  source: string | null;
  createdAt: string;
}

export const contactService = {
  /** Formulário de contato (público): grava e avisa a loja por e-mail. */
  send(input: { name: string; email: string; phone?: string | null; message: string }) {
    return api.post<{ id: string }>('/api/public/contact', input, { anonymous: true });
  },
  /** Newsletter (público, idempotente). */
  subscribe(email: string, source = 'home') {
    return api.post<{ subscribed: boolean }>('/api/public/newsletter', { email, source }, { anonymous: true });
  },
  listMessages() {
    return api.get<{ messages: ApiContactMessage[] }>('/api/admin/contact-messages');
  },
  setMessageStatus(id: string, status: ContactMessageStatus) {
    return api.patch<{ id: string; status: ContactMessageStatus }>(`/api/admin/contact-messages/${id}`, { status });
  },
  listSubscribers() {
    return api.get<{ subscribers: ApiNewsletterSubscriber[] }>('/api/admin/newsletter');
  },
};
