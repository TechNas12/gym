import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const STATIC_DIR = process.env.STATIC_DIR || path.resolve('..', 'frontend', 'dist');

export function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname.startsWith('/api')) return false;

  let filePath = path.join(STATIC_DIR, pathname.replace(/^\/+/, ''));
  let isFile = false;
  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) isFile = true;
  } catch { /* not a direct file */ }

  // Fallback to index.html for client-side routing (SPA)
  if (!isFile) {
    filePath = path.join(STATIC_DIR, 'index.html');
    try {
      if (!fs.statSync(filePath).isFile()) return false;
    } catch {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  let cacheControl = 'public, max-age=3600';
  if (pathname.startsWith('/assets/')) {
    cacheControl = 'public, max-age=31536000, immutable';
  } else if (pathname === '/' || pathname.endsWith('.html') || pathname === '/sw.js') {
    cacheControl = 'no-cache';
  }

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': cacheControl
    });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
    return true;
  } catch {
    return false;
  }
}
