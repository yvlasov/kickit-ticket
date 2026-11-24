import { useState, useEffect, type FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router';

function apiFetch(path: string, options: RequestInit): Promise<Response> {
  return fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
}

export default function Verify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'expired' | 'invalid' | 'used' | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    apiFetch('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .then((data) => {
        setStatus(data.status);
      })
      .catch(() => {
        setStatus('invalid');
      });
  }, [token]);

  function handleResend(e: FormEvent) {
    e.preventDefault();
    setResendError(null);
    setResendSent(false);

    apiFetch('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email: resendEmail.trim() }),
    })
      .then((res) => {
        if (res.ok) {
          setResendSent(true);
        } else {
          setResendError('Failed to send verification email');
        }
      })
      .catch(() => {
        setResendError('Failed to send verification email');
      });
  }

  if (status === 'loading' || !status) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md text-center">
          <p className="text-gray-600">Verifying your email...</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4 text-green-600">Email verified!</h1>
          <p className="text-gray-600 mb-6">Your account has been activated.</p>
          <a href="/login" className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 inline-block">
            Go to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">
          {status === 'expired' && 'Link expired'}
          {status === 'invalid' && 'Invalid link'}
          {status === 'used' && 'Link already used'}
        </h1>
        <p className="text-gray-600 mb-6">
          {status === 'expired' && 'This verification link has expired. Request a new one below.'}
          {status === 'invalid' && 'This verification link is invalid. Please sign up again.'}
          {status === 'used' && 'This link has already been used. Your email is verified.'}
        </p>

        {(status === 'expired' || status === 'invalid') && (
          <form onSubmit={handleResend} className="space-y-3">
            <input
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
              placeholder="Enter your email"
              required
            />
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700"
            >
              Resend verification email
            </button>
            {resendSent && (
              <p className="text-green-600 text-sm">Verification email sent! Check your inbox.</p>
            )}
            {resendError && (
              <p className="text-red-600 text-sm">{resendError}</p>
            )}
          </form>
        )}

        {status === 'used' && (
          <a href="/login" className="text-blue-600 hover:underline text-sm inline-block mt-2">
            Go to login
          </a>
        )}
      </div>
    </div>
  );
}
