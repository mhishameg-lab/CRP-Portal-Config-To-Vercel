/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/',
        destination: '/app.html',
      },
    ];
  },
};
module.exports = nextConfig;
