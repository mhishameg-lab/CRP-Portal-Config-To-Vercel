/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow large API response bodies for data-heavy endpoints
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
};

module.exports = nextConfig;
