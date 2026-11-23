export default function CheckEmail() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">Check your email</h1>
        <p className="text-gray-600 mb-6">
          We sent a verification link to your email address. Click the link to activate your account.
        </p>
        <a href="/signup" className="text-blue-600 hover:underline text-sm">
          Back to sign up
        </a>
      </div>
    </div>
  );
}
