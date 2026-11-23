import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function apiFetch(path: string, options: RequestInit): Promise<Response> {
  return fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
}

export function handleUnauthorized(): void {
  queryClient.clear();
  window.location.href = '/login';
}

export { apiFetch };
