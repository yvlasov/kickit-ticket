import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { apiFetch, handleUnauthorized } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (body.error?.details) {
          const fields: Record<string, string> = {};
          body.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setFieldErrors(fields);
        }
        if (res.status === 401) {
          setApiError('Invalid email or password');
        } else if (res.status === 403) {
          setApiError('Email not verified. Enter your email below to resend verification.');
        } else {
          setApiError(body.error?.message ?? 'Login failed');
        }
        throw new Error(body.error?.message ?? 'Login failed');
      }
      return res.json();
    },
    onSuccess: () => {
      navigate('/', { replace: true });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiFetch('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message ?? 'Resend failed');
      }
      return res;
    },
    onSuccess: () => {
      setResendSent(true);
      setResendError(null);
    },
    onError: () => {
      setResendError('Failed to send verification email');
    },
  });

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    setApiError(null);
    setFieldErrors({});
    setResendSent(false);
    loginMutation.mutate();
  }

  function handleResend(e: FormEvent) {
    e.preventDefault();
    setResendError(null);
    setResendSent(false);
    resendMutation.mutate(resendEmail);
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Login</h1>

        {apiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">
            {apiError}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full border rounded px-3 py-2 text-sm ${fieldErrors.email ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="you@example.com"
              disabled={loginMutation.isPending}
            />
            {fieldErrors.email && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.email}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full border rounded px-3 py-2 text-sm ${fieldErrors.password ? 'border-red-500' : 'border-gray-300'}`}
              placeholder="Min 8 characters"
              disabled={loginMutation.isPending}
            />
            {fieldErrors.password && (
              <p className="text-red-500 text-xs mt-1">{fieldErrors.password}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loginMutation.isPending ? 'Logging in...' : 'Login'}
          </button>
        </form>

        {apiError?.includes('not verified') && (
          <div className="mt-6 pt-4 border-t">
            <p className="text-sm text-gray-600 mb-3">
              Resend verification email:
            </p>
            <form onSubmit={handleResend} className="space-y-2">
              <input
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                placeholder="Enter your email"
                required
                disabled={resendMutation.isPending}
              />
              <button
                type="submit"
                disabled={resendMutation.isPending}
                className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {resendMutation.isPending ? 'Sending...' : 'Resend verification'}
              </button>
              {resendSent && (
                <p className="text-green-600 text-sm text-center">Verification email sent! Check your inbox.</p>
              )}
              {resendError && (
                <p className="text-red-600 text-sm text-center">{resendError}</p>
              )}
            </form>
          </div>
        )}

        <div className="mt-4 text-center">
          <a href="/signup" className="text-blue-600 hover:underline text-sm">
            Don't have an account? Sign up
          </a>
        </div>
      </div>
    </div>
  );
}
