import Head from 'next/head';
import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace('/app.html');
    }
  }, []);

  return (
    <>
      <Head>
        <meta httpEquiv="refresh" content="0; url=/app.html" />
        <title>Redirecting…</title>
      </Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', padding: 24 }}>
        <div style={{ maxWidth: 520, textAlign: 'center', color: '#102a43' }}>
          <h1 style={{ fontSize: '1.8rem', marginBottom: '0.75rem' }}>Redirecting to the portal…</h1>
          <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#334e68' }}>
            If you are not redirected automatically, <a href="/app.html">click here to continue</a>.
          </p>
        </div>
      </div>
    </>
  );
}
