/** @type {import('next').NextConfig} */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL || 'http://api:4000'

const nextConfig = {
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // 浏览器只访问 web 服务；/api/* 由 Next 服务端代理到内部 api 服务
    return [{ source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` }]
  },
}

module.exports = nextConfig
