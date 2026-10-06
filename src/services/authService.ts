import { api } from './api';
import type { ApiAddress, ApiUser } from './types';

export const authService = {
  register(input: { name: string; email: string; password: string; phone?: string; privacyConsent: true }) {
    return api.post<{ user: ApiUser; token: string }>('/api/auth/register', input, { anonymous: true });
  },
  login(email: string, password: string) {
    return api.post<{ user: ApiUser; token: string }>('/api/auth/login', { email, password }, { anonymous: true });
  },
  me(token?: string) {
    return api.get<{ user: ApiUser }>('/api/auth/me', token ? { token } : undefined);
  },
  updateMe(input: { name?: string; phone?: string }) {
    return api.put<{ user: ApiUser }>('/api/me', input);
  },
  /** Reenvia o link de confirmação de e-mail (cliente logado). */
  resendVerification() {
    return api.post<{ alreadyVerified: boolean; message: string }>('/api/auth/resend-verification');
  },
  getAddress() {
    return api.get<{ address: ApiAddress | null }>('/api/me/address');
  },
  saveAddress(input: {
    zipCode: string; street: string; number: string; complement?: string | null;
    district: string; city: string; state: string;
  }) {
    return api.put<{ address: ApiAddress }>('/api/me/address', input);
  },
  verifyEmail(token: string) {
    return api.post<{ user: ApiUser }>('/api/auth/verify-email', { token }, { anonymous: true });
  },
  forgotPassword(email: string) {
    return api.post<{ message: string }>('/api/auth/forgot-password', { email }, { anonymous: true });
  },
  resetPassword(token: string, password: string) {
    return api.post<{ message: string }>('/api/auth/reset-password', { token, password }, { anonymous: true });
  },
};
