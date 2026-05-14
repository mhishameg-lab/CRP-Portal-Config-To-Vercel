// pages/404.js — On-brand not-found page

import Head from 'next/head';

export default function NotFound() {
  return (
    <>
      <Head>
        <title>Page Not Found · ICO Center Portal</title>
      </Head>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'DM Sans', sans-serif;
          background: #060d1f;
          color: #e8f0ff;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          -webkit-font-smoothing: antialiased;
        }

        .container {
          text-align: center;
          max-width: 420px;
          animation: fadeUp 0.5s ease both;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .glyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 20px;
          background: linear-gradient(135deg, #1a3160 0%, #0f1e3d 100%);
          border: 1px solid rgba(37,99,235,0.25);
          box-shadow: 0 0 40px rgba(37,99,235,0.15);
          margin-bottom: 28px;
        }

        .glyph svg { width: 36px; height: 36px; }

        .code {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          font-weight: 500;
          color: #3b82f6;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        h1 {
          font-size: 26px;
          font-weight: 700;
          color: #e8f0ff;
          margin-bottom: 10px;
          line-height: 1.2;
        }

        p {
          font-size: 15px;
          color: #8ba8d4;
          line-height: 1.6;
          margin-bottom: 32px;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 11px 24px;
          background: #2563eb;
          color: #fff;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 600;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          text-decoration: none;
          transition: background 0.18s ease, transform 0.18s ease;
        }

        .btn:hover {
          background: #1d4ed8;
          transform: translateY(-1px);
        }

        .divider {
          width: 48px;
          height: 2px;
          background: linear-gradient(90deg, #2563eb, transparent);
          border-radius: 2px;
          margin: 0 auto 24px;
        }
      `}</style>

      <div className="container">
        <div className="glyph">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 7v13M18 24v2" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round"/>
            <path d="M6.5 30h23a2 2 0 001.73-3L19.73 8a2 2 0 00-3.46 0L4.77 27a2 2 0 001.73 3z"
                  stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="code">Error 404</div>
        <div className="divider" />
        <h1>Page not found</h1>
        <p>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Head back to the portal to continue.
        </p>

        <a href="/" className="btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Return to Portal
        </a>
      </div>
    </>
  );
}
