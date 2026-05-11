// pages/index.js
// Serves the existing GAS HTML UI as a Next.js page.
// The gscript-shim.js intercepts google.script.run and routes to /api/rpc.
//
// Option A (recommended): keep your index.html in /public and redirect here.
// Option B: paste your full GAS index.html content into the JSX below.
//
// For now this page just loads /public/index.html via an iframe so you can
// iterate on the HTML file without touching React. Once you're ready you can
// inline the HTML directly.

import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>ICO Center Portal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      {/*
        Simply proxy the static HTML file.
        Copy your GAS index.html (the output of HtmlService) to /public/app.html,
        add <script src="/gscript-shim.js"></script> as the FIRST script tag,
        and this iframe will load it.
      */}
      <iframe
        src="/app.html"
        style={{ width: '100%', height: '100vh', border: 'none' }}
        title="ICO Center Portal"
      />
    </>
  );
}
