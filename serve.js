#!/usr/bin/env node
/** Minimal static server for previewing dist/ locally. No dependencies. */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, process.env.DIST || 'dist');
const PORT = Number(process.env.PORT || 4321);
// All interfaces by default, so phones and laptops on the same Wi-Fi can look.
// HOST=127.0.0.1 keeps it to this machine only.
const HOST = process.env.HOST || '0.0.0.0';

/**
 * The build bakes a base path into every link (BASE_URL). Read it back out of
 * the generated home page and mount dist/ there, so a site built for
 * /alneya/ previews correctly instead of 404ing on all its assets.
 *
 * Re-read whenever index.html changes: rebuilding with a different BASE_URL
 * while the server is up must not leave it serving from the old mount point.
 */
let baseCache = { mtime: 0, value: '/' };
function builtBase() {
  const home = path.join(ROOT, 'index.html');
  try {
    const mtime = fs.statSync(home).mtimeMs;
    if (mtime !== baseCache.mtime) {
      const match = fs.readFileSync(home, 'utf8').match(/href="(\/[^"]*?)assets\/css\/site\.css"/);
      baseCache = { mtime, value: match ? match[1] : '/' };
    }
  } catch {
    baseCache = { mtime: 0, value: '/' };
  }
  return baseCache.value;
}

/** Every non-internal IPv4 address of this machine, for the startup banner. */
function lanAddresses() {
  if (HOST !== '0.0.0.0' && HOST !== '::') return [];
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(ROOT)) {
  console.error(`${path.relative(__dirname, ROOT)}/ does not exist yet — run \`npm run build\` first.`);
  process.exit(1);
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const BASE = builtBase();

    // Send bare "/" to wherever this build actually lives.
    if (BASE !== '/' && (url === '/' || url === '')) {
      res.writeHead(302, { Location: BASE }).end();
      return;
    }
    // Strip the build's base prefix before looking the file up on disk.
    const rel = BASE !== '/' && url.startsWith(BASE) ? url.slice(BASE.length - 1) : url;
    let file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    // ROOT + sep, so a sibling directory like `dist-backup` can't sneak through.
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    if (!fs.existsSync(file)) {
      const notFound = path.join(ROOT, '404.html');
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, HOST, () => {
    const base = builtBase();
    console.log(`\n  Alneya preview — ${path.relative(__dirname, ROOT)}/  (base "${base}")`);
    console.log(`    local     http://localhost:${PORT}${base}`);
    for (const address of lanAddresses()) console.log(`    network   http://${address}:${PORT}${base}`);
    console.log(`\n  Anyone on this network can reach it. Ctrl-C to stop.\n`);
  });
