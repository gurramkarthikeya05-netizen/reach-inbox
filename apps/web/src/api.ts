import type { EmailListItemDto, PaginatedResponse, SenderDto, UserDto } from '@reachinbox/contracts';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include' });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  getMe: () => request<{ user: UserDto | null }>('/api/auth/me'),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  getSenders: () => request<{ senders: SenderDto[] }>('/api/senders'),
  getEmails: (view: 'scheduled' | 'sent') =>
    request<PaginatedResponse<EmailListItemDto>>(`/api/emails?status=${view}&pageSize=100`),
  schedule: (formData: FormData) =>
    request<{ campaignId: string; count: number }>('/api/emails/schedule', {
      method: 'POST',
      body: formData,
    }),
};