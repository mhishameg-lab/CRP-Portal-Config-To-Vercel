// pages/_document.js
// Defines the outer HTML shell for all server-rendered Next.js pages
// (error pages, future React pages, etc.). Does NOT affect app.html
// since that is served directly via next.config.js rewrites.

import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="application-name"              content="ICO Center Portal" />
        <meta name="description"                   content="Lead management and tracking CRM for ICO centers" />
        <meta name="theme-color"                   content="#0f1e3d" />
        <meta name="apple-mobile-web-app-capable"  content="yes" />
        <meta name="apple-mobile-web-app-title"    content="ICO Portal" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon"     type="image/svg+xml" href="/favicon.svg" />
        <link rel="manifest"                       href="/manifest.json" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
