/*
 * prism — Service Worker（装到手机主屏幕后的离线阅读）
 *
 *   页面（HTML）：先走网络，拿到就存一份；没网时给缓存里的。文章页只留最近 20 篇。
 *   图片（assets/）：先看缓存，没有再下载；最多留 400 张。
 *   样式 / 脚本 / 图标：先给缓存，同时后台更新，下次打开就是新的。
 */
const VERSION = 'v1';
const PAGES = `prism-pages-${VERSION}`;
const IMAGES = `prism-images-${VERSION}`;
const STATIC = `prism-static-${VERSION}`;
const MAX_ARTICLES = 20;
const MAX_IMAGES = 400;
const ARTICLE_RE = /\/\d{4}-\d{2}-\d{2}(-\d+)?\.html$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) =>
    c.addAll(['./styles.css', './app.js', './favicon.svg', './manifest.webmanifest', './icon-192.png'])
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('prism-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

/** 只留最近的 max 条（keys() 按写入顺序，先写的先删）；filter 限定参与计数的条目。 */
async function trim(cacheName, max, filter = () => true) {
  const c = await caches.open(cacheName);
  const keys = (await c.keys()).filter((r) => filter(new URL(r.url).pathname));
  for (const r of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(r);
}

async function networkFirst(req) {
  const c = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await c.delete(req, { ignoreSearch: true }); // 重新写入，排到最新
      await c.put(req, res.clone());
      trim(PAGES, MAX_ARTICLES, (p) => ARTICLE_RE.test(p));
    }
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(IMAGES);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) { await c.put(req, res.clone()); trim(IMAGES, MAX_IMAGES); }
  return res;
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 字体、外链不管
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(networkFirst(req));
  } else if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req));
  } else if (/\.(css|js|svg|png|webmanifest|xml)$/.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});
