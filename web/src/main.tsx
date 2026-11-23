import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import Signup from './pages/Signup';
import CheckEmail from './pages/CheckEmail';
import Verify from './pages/Verify';
import Login from './pages/Login';

const queryClient = new QueryClient();

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Login />} />
      </Routes>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
