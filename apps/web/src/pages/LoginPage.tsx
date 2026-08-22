import { API_URL } from '../api';

export function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark compact">ONB</div>
        <h1 id="login-title">Login</h1>
        <a className="google-button" href={`${API_URL}/api/auth/google`}>
          <span className="google-g" aria-hidden="true">G</span>
          Login with Google
        </a>
        <p className="login-note">Use your Google account to access the scheduler.</p>
      </section>
    </main>
  );
}