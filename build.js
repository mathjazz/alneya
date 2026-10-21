#!/usr/bin/env node
/**
 * Alneya site builder.
 *
 * Reads the templates in src/ once per locale and writes a complete static
 * site to dist/. No dependencies — plain Node.
 *
 *   node build.js                 build into dist/
 *   BASE_URL=/repo/ node build.js build for a GitHub Pages project site
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, process.env.OUT_DIR || 'dist');

const SITE_URL = (process.env.SITE_URL || 'https://alneya.com').replace(/\/$/, '');
// Leading + trailing slash. "/" for a user/apex domain, "/repo/" for a project page.
const BASE = ('/' + (process.env.BASE_URL || '/').replace(/^\/|\/$/g, '') + '/').replace('//', '/');

const PAGES = ['home', 'services', 'library', 'experiences', 'about', 'contact'];
const LOCALES = ['en', 'sl'];
const DEFAULT_LOCALE = 'en';
// A theme is a palette file, optionally plus the dark-structure file.
//   light      ivory + amethyst, everything light
//   green      deep moss + beige, dark header/hero/method
//   sage       soft eucalyptus, everything light
//   sage-deep    soft eucalyptus, dark header/hero/method
//   violet       amethyst + antique gold, everything light
//   violet-deep    amethyst + antique gold, dark header/hero/method
//   lavender       soft wisteria, dark header/hero/method
//   baumit-1033    Baumit Life 1033 as the darkest colour, dark text on it
//   baumit-1023    Baumit Life 1023 as the darkest colour, dark text on it
//   baumit-0674    Baumit Life 0674 as the darkest colour, dark text on it
const THEMES = {
  light: [],
  green: ['theme-tokens-green.css', 'theme-dark.css'],
  sage: ['theme-tokens-sage.css'],
  'sage-deep': ['theme-tokens-sage.css', 'theme-dark.css'],
  violet: ['theme-tokens-violet.css'],
  'violet-deep': ['theme-tokens-violet.css', 'theme-dark.css'],
  lavender: ['theme-tokens-lavender.css', 'theme-dark.css'],
  'baumit-1033': ['theme-tokens-baumit-1033.css', 'theme-paint.css'],
  'baumit-1023': ['theme-tokens-baumit-1023.css', 'theme-paint.css'],
  'baumit-0674': ['theme-tokens-baumit-0674.css', 'theme-paint.css'],
};
// what the browser chrome should tint itself (Safari 15+, Chrome on Android):
// the colour at the very top of the page, i.e. the header
const THEME_COLORS = {
  light: '#fdfbf8',
  green: '#232e26',
  sage: '#fcfbf7',
  'sage-deep': '#45553f',
  violet: '#fdfaff',
  'violet-deep': '#3a2852',
  lavender: '#51446a',
  'baumit-1033': '#7d9b77',
  'baumit-1023': '#808d70',
  'baumit-0674': '#a188a2',
};
const THEME = process.env.THEME || 'light';
if (!THEMES[THEME]) throw new Error(`Unknown THEME "${THEME}" — try: ${Object.keys(THEMES).join(', ')}`);
const THEME_FILES = THEMES[THEME].map((file) => ({ file }));

/* ------------------------------------------------------------------ utils */

const read = (p) => fs.readFileSync(p, 'utf8');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Resolve "a.b.c" against a scope chain, innermost first.
 *
 * A leading "." pins the lookup to the current item only. Without that,
 * {{#if .href}} on a list item with no href of its own would quietly find the
 * enclosing object's href and render the wrong branch.
 */
function lookup(keyPath, scopes) {
  const parts = keyPath.split('.').filter(Boolean);
  const first = keyPath.startsWith('.') ? scopes.length - 1 : 0;
  for (let i = scopes.length - 1; i >= first; i--) {
    let cur = scopes[i];
    let ok = true;
    for (const part of parts) {
      if (cur != null && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
      else { ok = false; break; }
    }
    if (ok) return cur;
  }
  return undefined;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/* -------------------------------------------------------------- templating
 *
 * {{ a.b }}        escaped value
 * {{{ a.b }}}      raw value (trusted HTML from the locale files)
 * {{> partial }}   include src/partials/<name>.html (or .svg)
 * {{#each a.b}}…{{/each}}   iterate an array; inside, {{ .field }} is the item
 * {{#if a.b}}…{{else}}…{{/if}}
 *
 * A leading "." in a key means "the current item", so list templates read
 * {{ .title }} and page templates read {{ home.hero.title }}.
 */

const partialCache = new Map();
function partial(name) {
  if (!partialCache.has(name)) {
    const base = path.join(SRC, 'partials', name);
    const file = ['.html', '.svg'].map((ext) => base + ext).find(fs.existsSync);
    if (!file) throw new Error(`Unknown partial: ${name}`);
    partialCache.set(name, read(file));
  }
  return partialCache.get(name);
}

const OPEN_TAG = /\{\{#(each|if|unless)\s+([^}]+?)\s*\}\}/;
const ANY_TAG = /\{\{#(?:each|if|unless)\s+[^}]+?\s*\}\}|\{\{else\}\}|\{\{\/(?:each|if|unless)\}\}/g;

/** Split a block body at its own {{else}}, ignoring {{else}} inside nested blocks. */
function splitElse(body) {
  ANY_TAG.lastIndex = 0;
  let level = 0, m;
  while ((m = ANY_TAG.exec(body))) {
    if (m[0].startsWith('{{#')) level++;
    else if (m[0].startsWith('{{/')) level--;
    else if (level === 0) return [body.slice(0, m.index), body.slice(m.index + m[0].length)];
  }
  return [body, ''];
}

function render(template, scopes, depth = 0) {
  if (depth > 24) throw new Error('Template nesting too deep — is a partial including itself?');

  // Partials first, so their own tags get rendered in this pass. Repeat until
  // none are left, since a partial may itself include another one.
  let rest = template;
  for (let pass = 0; /\{\{>\s*[\w-]+\s*\}\}/.test(rest); pass++) {
    if (pass > 8) throw new Error('Partial include loop — a partial is including itself');
    rest = rest.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => partial(name));
  }

  // Blocks, outermost-first, matching close tags by depth so they can nest.
  let out = '';
  for (;;) {
    const open = OPEN_TAG.exec(rest);
    if (!open) { out += rest; break; }
    out += rest.slice(0, open.index);

    const [, kind, key] = open;
    const bodyStart = open.index + open[0].length;
    ANY_TAG.lastIndex = bodyStart;
    let level = 1, bodyEnd = -1, afterClose = -1, tag;
    while ((tag = ANY_TAG.exec(rest))) {
      if (tag[0].startsWith('{{#')) level++;
      else if (tag[0].startsWith('{{/') && --level === 0) { bodyEnd = tag.index; afterClose = ANY_TAG.lastIndex; break; }
    }
    if (bodyEnd < 0) throw new Error(`Unclosed {{#${kind} ${key}}}`);

    const body = rest.slice(bodyStart, bodyEnd);
    const value = lookup(key, scopes);

    if (kind === 'each') {
      const list = Array.isArray(value) ? value : [];
      out += list
        .map((item, i) => {
          const ctx = item !== null && typeof item === 'object' ? item : { value: item };
          return render(body, [...scopes, { ...ctx, '@index': i, '@number': String(i + 1).padStart(2, '0') }], depth + 1);
        })
        .join('');
    } else {
      const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
      const [whenTrue, whenFalse] = splitElse(body);
      out += render((kind === 'if') === truthy ? whenTrue : whenFalse, scopes, depth + 1);
    }
    rest = rest.slice(afterClose);
  }

  // Values.
  out = out.replace(/\{\{\{\s*([^}\s]+)\s*\}\}\}/g, (_, key) => str(lookup(key, scopes), key));
  out = out.replace(/\{\{\s*([^}#/>\s][^}\s]*)\s*\}\}/g, (_, key) => escapeHtml(str(lookup(key, scopes), key)));

  return out;
}

const missing = new Set();
function str(value, key) {
  if (value === undefined || value === null) {
    missing.add(key);
    return '';
  }
  return value;
}

/** Structured data, built as real JSON so nothing has to be hand-escaped. */
function jsonLd(t, url, assetsAbs) {
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'ProfessionalService',
      name: t.site.name,
      alternateName: t.site.founder,
      description: t.site.tagline,
      url,
      image: `${assetsAbs}/img/alneya-hero.jpg`,
      email: t.site.email,
      inLanguage: t.meta.locale,
      founder: { '@type': 'Person', name: t.site.founder, jobTitle: t.site.role },
      sameAs: [t.links.instagram, t.links.facebook, t.links.linkedin],
    },
    null,
    2
  ).replace(/</g, '\\u003c');
}

/* ------------------------------------------------------------------ build */

function urlFor(pageId, locale, locales) {
  const slug = locales[locale].slugs[pageId];
  const prefix = locale === DEFAULT_LOCALE ? BASE : BASE + locale + '/';
  return slug ? `${prefix}${slug}/` : prefix;
}

function build() {
  const locales = Object.fromEntries(
    LOCALES.map((l) => [l, JSON.parse(read(path.join(SRC, 'locales', `${l}.json`)))])
  );

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const layout = read(path.join(SRC, 'layout.html'));
  const year = String(new Date().getFullYear());
  const sitemap = [];

  for (const locale of LOCALES) {
    const t = locales[locale];

    for (const pageId of PAGES) {
      const url = urlFor(pageId, locale, locales);
      const alternates = LOCALES.map((l) => ({
        lang: l,
        name: locales[l].meta.name,
        url: urlFor(pageId, l, locales),
        absUrl: SITE_URL + urlFor(pageId, l, locales),
        current: l === locale,
      }));
      // hreflang needs absolute URLs, plus an x-default for unmatched languages.
      const hreflangs = alternates
        .map((a) => ({ lang: a.lang, absUrl: a.absUrl }))
        .concat([{ lang: 'x-default', absUrl: SITE_URL + urlFor(pageId, DEFAULT_LOCALE, locales) }]);

      const helpers = {
        '@lang': locale,
        '@page': pageId,
        '@base': BASE,
        '@assets': BASE + 'assets',
        '@assetsAbs': SITE_URL + BASE + 'assets',
        '@theme': THEME,
        '@themeFiles': THEME_FILES,
        '@themeColor': THEME_COLORS[THEME],
        '@url': url,
        '@canonical': SITE_URL + url,
        '@year': year,
        '@alternates': alternates,
        '@hreflangs': hreflangs,
        '@ogAlternates': alternates.filter((a) => !a.current).map((a) => locales[a.lang].meta.ogLocale),
        '@jsonLd': jsonLd(t, SITE_URL + url, SITE_URL + BASE + 'assets'),
        // @nav.<pageId> gives {url, active} for the header and footer links
        '@nav': Object.fromEntries(
          PAGES.map((p) => [p, { url: urlFor(p, locale, locales), active: p === pageId }])
        ),
      };

      const scopes = [t, helpers];
      const body = render(read(path.join(SRC, 'pages', `${pageId}.html`)), scopes);
      const html = render(layout, [...scopes, { '@body': body, '@pageMeta': t.pages[pageId] }]);

      const outDir = path.join(DIST, url.slice(BASE.length));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), html);
      sitemap.push({ url: SITE_URL + url, alternates });
    }
  }

  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));

  // 404: render the English contact-less shell with a dedicated message.
  const t = locales[DEFAULT_LOCALE];
  const notFoundScopes = [
    t,
    {
      '@lang': DEFAULT_LOCALE, '@page': '404', '@base': BASE, '@assets': BASE + 'assets',
      '@assetsAbs': SITE_URL + BASE + 'assets', '@hreflangs': [], '@ogAlternates': [],
      '@theme': THEME, '@themeFiles': THEME_FILES, '@themeColor': THEME_COLORS[THEME],
      '@jsonLd': jsonLd(t, SITE_URL + BASE + '404.html', SITE_URL + BASE + 'assets'),
      '@url': BASE + '404.html', '@canonical': SITE_URL + BASE + '404.html', '@year': year,
      '@alternates': [],
      '@nav': Object.fromEntries(PAGES.map((p) => [p, { url: urlFor(p, DEFAULT_LOCALE, locales), active: false }])),
    },
  ];
  const notFoundBody = render(read(path.join(SRC, 'partials', 'not-found.html')), notFoundScopes);
  fs.writeFileSync(
    path.join(DIST, '404.html'),
    render(layout, [...notFoundScopes, { '@body': notFoundBody, '@pageMeta': t.pages.notFound }])
  );

  fs.writeFileSync(
    path.join(DIST, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      sitemap
        .map(
          (e) =>
            `  <url>\n    <loc>${e.url}</loc>\n` +
            e.alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.lang}" href="${SITE_URL + a.url}"/>\n`).join('') +
            `  </url>\n`
        )
        .join('') +
      `</urlset>\n`
  );

  fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}${BASE}sitemap.xml\n`);
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  // GitHub Pages reads the custom domain from a CNAME at the root of the
  // published site. Only write it for a real apex build: the side-by-side
  // theme previews live under /alneya-<theme>/ on another host, and a CNAME
  // in those would point them at the wrong domain.
  const host = SITE_URL.replace(/^https?:\/\//, '');
  if (BASE === '/' && !host.endsWith('github.io') && !host.startsWith('localhost')) {
    fs.writeFileSync(path.join(DIST, 'CNAME'), host + '\n');
  }

  // Report anything that still needs a human.
  if (missing.size) {
    console.warn(`\n  ${missing.size} missing translation key(s):`);
    for (const k of [...missing].sort()) console.warn(`    ${k}`);
  }
  const todos = [];
  const walk = (node, trail) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${trail}[${i}]`));
    if (node && typeof node === 'object')
      return Object.entries(node).forEach(([k, v]) => (k === '_todo' ? todos.push(`${trail}: ${v}`) : walk(v, trail ? `${trail}.${k}` : k)));
  };
  LOCALES.forEach((l) => walk(locales[l], l));
  if (todos.length) {
    console.log(`\n  ${todos.length} placeholder(s) still to fill in:`);
    todos.forEach((t) => console.log(`    ${t}`));
  }

  console.log(`\n  Built ${sitemap.length} pages into ${path.relative(ROOT, DIST)}/ — ${THEME} theme, base "${BASE}", site ${SITE_URL}\n`);
}

build();
