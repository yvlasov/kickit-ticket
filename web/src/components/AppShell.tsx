import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface User {
  id: string;
  email: string;
}

function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/auth/me', { method: 'GET' });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch user');
      }
      return res.json() as Promise<User>;
    },
    retry: false,
  });
}

function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok && res.status !== 204) {
        throw new Error('Logout failed');
      }
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.href = '/login';
    },
  });
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useMe();
  const logoutMutation = useLogout();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="text-lg font-bold text-blue-600">
            KickIt Ticket
          </a>
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{user.email}</span>
              <button
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="text-sm text-blue-600 hover:underline disabled:opacity-50"
              >
                {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
