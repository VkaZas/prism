/*
 * 南半球聊财经每日Summary — 构建器 (build.mjs)
 * ------------------------------------------------------------------
 * 把 daily_summaries/jason_解读_YYYY-MM-DD.md 系列文档构建成一个
 * Medium 风格、简约科技感的静态站点（GitHub Pages，/docs 即根）。
 *
 * 实现严格遵守 spec §4（HTML 结构 / 类名 / ID 一字不差）与 §5（构建规则）。
 * 详见 docs/superpowers/specs/2026-06-14-nanbanqiu-daily-summary-site-design.md
 *
 * 设计要点：
 *   - 源目录用 import.meta.url 推算（与 cwd 无关）。
 *   - 抽 base64 图 → docs/assets/<date>/imgN.<ext>，HTML 内不残留 data:image。
 *   - markdown-it 渲染（html:true, linkify:true, breaks:false），每个 <h2> 注入 id=sec-N。
 *   - 单篇 try/catch 跳过不中断；纯文字篇正常出页、无缩略图。
 *   - 注入模板的动态文本一律 HTML 转义。
 *   - styles.css / app.js 若不存在则跳过复制并告警（不崩）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

/* ------------------------------------------------------------------ *
 * 路径与常量
 * ------------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, '..', 'daily_summaries'); // 源 md（与 cwd 无关）
const SRC_ASSETS = path.resolve(__dirname, 'src');                // styles.css / app.js 源
const OUT_DIR = path.resolve(__dirname, 'docs');                  // 构建输出 = GH Pages 根
const ASSETS_DIR = path.join(OUT_DIR, 'assets');                  // 抽出的图片

// 仅用于 feed.xml / og: / canonical 的【绝对】链接；用户一次性设置 SITE_URL。
const SITE_URL = (process.env.SITE_URL || 'https://vkazas.github.io/prism').replace(/\/+$/, '');

const SITE_NAME = '南半球聊财经每日Summary';
const SITE_TAGLINE = '每日帖子深度解读 · 宏观财经的体系化阅读';
const SITE_SOURCE_DEFAULT = '南半球聊财经';

// 文件名匹配：^jason_解读_(YYYY-MM-DD).md$
const FILE_RE = /^jason_解读_(\d{4}-\d{2}-\d{2})\.md$/;

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** HTML 文本转义（注入模板的所有动态文本都要走它）。 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 属性值转义（用于 alt / content 等）——与 esc 同策略即可。 */
const escAttr = esc;

/** 把 YYYY-MM-DD 渲染成 "2026 · 06 · 14"。 */
function dotDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]} · ${m[2]} · ${m[3]}` : date;
}

/** 把 YYYY-MM-DD 渲染成相邻导航用的短日期 "06 · 14"。 */
function shortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[2]} · ${m[3]}` : date;
}

/** RFC-822 日期（feed.xml 用）；发帖默认 18:00 本地→当 UTC 处理，best-effort。 */
function rfc822(date) {
  const d = new Date(`${date}T18:00:00Z`);
  if (isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

/**
 * 去除 markdown 标记，得到大致纯文本（用于预览 / 阅读时长 / 标题回退）。
 * best-effort：去图片、链接保留文字、去强调/标题/引用/列表符号/行内代码反引号。
 */
function stripMarkdown(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')     // 链接 → 文字
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')       // 行内/围栏代码
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // ATX 标题
    .replace(/^\s{0,3}>\s?/gm, '')               // 引用前缀
    .replace(/^\s{0,3}[-*+]\s+/gm, '')           // 无序列表
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')         // 有序列表
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // 粗体
    .replace(/\*([^*]+)\*/g, '$1')               // 斜体
    .replace(/__([^_]+)__/g, '$1')               // 粗体(下划线)
    .replace(/~~([^~]+)~~/g, '$1')               // 删除线
    .replace(/\|/g, ' ')                         // 表格竖线
    .replace(/^[-=]{3,}\s*$/gm, '')              // 分隔线
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 文本「视觉长度」估算：CJK 字符算 1，连续 ASCII 词算 1（≈一个词）。
 * 用于阅读时长。
 */
function visualLen(text) {
  if (!text) return 0;
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) || []).length;
  return cjk + words;
}

/** 在中文/英文标点处把字符串截断到 ≤ max 字（保留一句话感觉）。 */
function truncateSmart(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  // 优先在最后一个句末标点处断
  const punct = /[。！？!?；;，,、…·]/g;
  let lastIdx = -1, m;
  while ((m = punct.exec(head)) !== null) lastIdx = m.index;
  if (lastIdx >= Math.floor(max * 0.4)) return head.slice(0, lastIdx + 1).trim();
  return head.trim() + '…';
}

/** 取前 1–2 句、≤ maxLen 字（用于首页预览）。 */
function firstSentences(text, maxLen) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // 在句末标点切句
  const parts = text.split(/(?<=[。！？!?])/);
  let out = '';
  for (const p of parts) {
    if (!p.trim()) continue;
    if (out && (out.length + p.length) > maxLen) break;
    out += p;
    // 已有 2 句且够长就停
    const sentenceCount = (out.match(/[。！？!?]/g) || []).length;
    if (sentenceCount >= 2 && out.length >= Math.min(40, maxLen)) break;
    if (out.length >= maxLen) break;
  }
  if (!out) out = text;
  return truncateSmart(out, maxLen);
}

/* ------------------------------------------------------------------ *
 * markdown-it：渲染 + h2 注入 id + 收集 TOC
 * ------------------------------------------------------------------ */
function makeRenderer() {
  return new MarkdownIt({
    html: true,       // 源可信（自产），允许内嵌 HTML
    linkify: true,    // 裸 URL 自动成链
    breaks: false,
    typographer: false,
  });
}

/**
 * 给 markdown-it 的图片渲染加 loading="lazy"（acceptance §7：图片懒加载）。
 * 灯箱由 app.js 在 .article-body img 点击时处理，无需额外属性。
 */
function installLazyImages(mdLib) {
  const defaultImageRender =
    mdLib.renderer.rules.image ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  mdLib.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    if (token.attrIndex('loading') < 0) token.attrPush(['loading', 'lazy']);
    return defaultImageRender(tokens, idx, options, env, self);
  };
}

/**
 * 渲染 markdown → { html, toc:[{id,text}] }。
 * 通过遍历 token 流：给每个 h2_open 注入 id="sec-N"，并从其后的 inline 取纯文本。
 */
function renderWithToc(md, mdLib) {
  const tokens = mdLib.parse(md, {});
  const toc = [];
  let n = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && t.tag === 'h2') {
      n += 1;
      const id = `sec-${n}`;
      t.attrSet('id', id);
      // 紧跟的 inline token 持有标题文本
      let text = '';
      const inline = tokens[i + 1];
      if (inline && inline.type === 'inline') {
        text = (inline.content || '').trim();
      }
      toc.push({ id, text });
    }
  }
  let html = mdLib.renderer.render(tokens, mdLib.options, {});
  // 防御性最终清扫（spec §7 硬性要求：HTML 内绝不残留 data:image）。
  // 正常路径下 extractImages 已抽干所有内联图；这里兜底任何漏网的 data:URI。
  if (html.indexOf('data:image') !== -1) {
    html = html
      // 整个 <img ... src="data:image...">（含单/双引号）替换为占位
      .replace(/<img\b[^>]*\bsrc\s*=\s*(["'])data:image[^"']*\1[^>]*>/gi,
        '<span class="img-missing">[图片未能内联]</span>')
      // 残留在属性/文本里的裸 data:image URI 一并清掉
      .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]*/gi, '');
  }
  return { html, toc };
}

/* ------------------------------------------------------------------ *
 * base64 图抽取
 * ------------------------------------------------------------------ */
const EXT_MAP = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp' };

/**
 * 抽出 markdown 里的 base64 内联图：写文件到 docs/assets/<date>/imgN.<ext>，
 * 并把 markdown 中的 data:URI 替换为相对路径 ./assets/<date>/imgN.<ext>。
 * 返回 { md: 替换后的 markdown, images: [相对路径...], count }。
 */
function extractImages(md, date) {
  // 捕获到 markdown 图片闭合 ) 之前的全部 data 载荷（含偶发非标准字符），
  // 解码时再清洗——确保任何 data:image 内联图都被这条规则吃掉，不残留进 HTML。
  const re = /!\[([^\]]*)\]\(\s*data:image\/(png|jpe?g|gif|webp);base64,([^)]*?)\s*\)/gi;
  let idx = 0;
  const images = [];
  let dirEnsured = false;

  let out = md.replace(re, (whole, alt, type, data) => {
    idx += 1;
    const ext = EXT_MAP[type.toLowerCase()] || 'png';
    const fileName = `img${idx}.${ext}`;
    const relPath = `./assets/${date}/${fileName}`;
    try {
      if (!dirEnsured) {
        fs.mkdirSync(path.join(ASSETS_DIR, date), { recursive: true });
        dirEnsured = true;
      }
      // 只保留合法 base64 字符再解码（防御非标准载荷）。
      const clean = String(data).replace(/[^A-Za-z0-9+/=]/g, '');
      const buf = Buffer.from(clean, 'base64');
      if (!buf.length) throw new Error('解码后为空（载荷非法）');
      fs.writeFileSync(path.join(ASSETS_DIR, date, fileName), buf);
      images.push(relPath);
      return `![${alt}](${relPath})`;
    } catch (e) {
      // 单图失败：保留原 alt 文本，丢掉 data:URI（绝不让 data:image 残留进 HTML）。
      console.warn(`  [warn] ${date} 第 ${idx} 张图解码/写入失败，已跳过：${e.message}`);
      return alt ? `*[图片未能解析：${alt}]*` : '';
    }
  });

  // 外部图片引用：![alt](jason_images/<date>/<file>) → 复制源文件到 docs/assets/<date>/<file>，
  // 并改写为 ./assets/<date>/<file>（与 base64 抽出的图统一放 assets 下，路径才正确）。
  const extRe = /!\[([^\]]*)\]\(\s*((?:\.\/)?jason_images\/[^)\s]+)\s*\)/gi;
  out = out.replace(extRe, (whole, alt, ref) => {
    const cleanRef = ref.replace(/^\.\//, '');            // jason_images/2026-06-14/post1_img1.png
    const rest = cleanRef.replace(/^jason_images\//, ''); // 2026-06-14/post1_img1.png
    const srcFile = path.join(SRC_DIR, cleanRef);
    const destRel = `./assets/${rest}`;
    const destFile = path.join(ASSETS_DIR, rest);
    try {
      if (!fs.existsSync(srcFile)) throw new Error('源图片不存在');
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(srcFile, destFile);
      images.push(destRel);
      return `![${alt}](${destRel})`;
    } catch (e) {
      console.warn(`  [warn] ${date} 外部图 ${cleanRef} 复制失败，已跳过：${e.message}`);
      return alt ? `*[图片缺失：${alt}]*` : '';
    }
  });

  return { md: out, images, count: images.length };
}

/* ------------------------------------------------------------------ *
 * 内容提取（标题 / 预览 / 帖数 / 时长 / 标签 / 来源）
 * ------------------------------------------------------------------ */

/** 取「## 今日要点速览 / 今日小结 …」之类速览区块的原始 markdown（到下一个 ## 之前）。 */
function extractOverviewBlock(md) {
  // 速览小节标题可能是「今日要点速览」「今日小结…」等；优先匹配含「速览」。
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*速览/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i]) && !/^##\s*帖/.test(lines[i])) { start = i; break; }
    }
  }
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

/** 标题提取（spec §5.4）。 */
function extractTitle(md, overview, date) {
  // 1) 速览区块中第一处粗体 **…**
  let candidate = '';
  if (overview) {
    const m = /\*\*([^*]+?)\*\*/.exec(overview);
    if (m) candidate = m[1];
  }
  // 2) 回退：速览首段首句
  if (!candidate) {
    const plain = stripMarkdown(overview);
    if (plain) candidate = firstSentences(plain, 40);
  }
  if (candidate) {
    candidate = candidate.trim()
      .replace(/^一句话(核心)?[:：]\s*/, '')          // 去前缀「一句话：」「一句话核心：」
      .replace(/^第[一二三四五六七八九十]+\s*[条点](?:[是为][:：，,、]?|[:：，,、])\s*/, '') // 去「第一条是」「第二点：」
      .replace(/^第[一二三四五六七八九十]+\s*[，,、]\s*/, '')               // 去「第一，」「第二、」
      .replace(/^[（(]\s*\d+\s*[)）]\s*/, '')        // 去「（1）」
      .replace(/^\d+\s*[.、)）]\s*/, '')              // 去「1. / 1、」
      .trim();
    // 去成对包裹的引号/书名号（仅当整体被一对包住时）
    candidate = candidate.replace(/^[「『“"](.+)[」』”"]$/, '$1').trim();
    // 修补落单括号：去掉无配对的首/尾「」『』
    if (/^[「『]/.test(candidate) && !/[」』]/.test(candidate)) candidate = candidate.replace(/^[「『]/, '');
    if (/[」』]$/.test(candidate) && !/[「『]/.test(candidate)) candidate = candidate.replace(/[」』]$/, '');
    candidate = candidate.trim();
    candidate = truncateSmart(candidate, 40);
  }
  // 3) 终极回退
  if (!candidate) candidate = `每日解读 · ${date}`;
  return candidate;
}

/** 预览（spec §5.5）：速览去 markdown 后首 1–2 句、≤120 字。 */
function extractPreview(overview) {
  const plain = stripMarkdown(overview);
  if (!plain) return '';
  // 跳过以 emoji 警示开头的「关于图片」类说明，取第一段实质文字
  const paras = plain.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let body = '';
  for (const p of paras) {
    if (/^[⚠️!！]/.test(p)) continue;       // 跳过警示段
    if (p.length < 6) continue;             // 跳过过短碎片
    body = p;
    break;
  }
  if (!body) body = paras[0] || plain;
  return firstSentences(body, 120);
}

/** 帖数（spec §5.6）：统计 ^##\s*帖 行数（含「帖子一」等变体）。 */
function extractPostCount(md) {
  const lines = md.split(/\r?\n/);
  let n = 0;
  for (const ln of lines) if (/^##\s*帖/.test(ln)) n += 1;
  return n;
}

/** 阅读时长（spec §5.7）：分钟 = max(1, round(visualLen/450))。 */
function readingMinutes(plainText) {
  const len = visualLen(plainText);
  return Math.max(1, Math.round(len / 450));
}

/** 标签（spec §5.8）：收集 #...# 或 #...，去重取前 2–3 个。 */
function extractTags(md) {
  const found = [];
  const seen = new Set();
  // 形如 #金融# 或 #TAX 或 `#金融`
  const re = /#([一-鿿A-Za-z0-9]+)#?/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const tag = m[1];
    // 过滤掉 markdown 标题误伤（标题用 ^# 开头且后跟空格，这里要求 # 紧贴非空白字符，已天然规避）
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(tag);
    if (found.length >= 6) break; // 先多收一些，后面取前 3
  }
  return found.slice(0, 3);
}

/** 来源（spec §5.9）：从顶部 blockquote / 说明里解析来源星球名，best-effort。 */
function extractSource(md) {
  // 取 H1 之后、第一个 ## 之前的「头部」区域
  const headEnd = md.search(/^##\s+/m);
  const head = headEnd === -1 ? md.slice(0, 1200) : md.slice(0, headEnd);
  // 直接命中「南半球聊财经」
  if (/南半球聊财经/.test(head)) return SITE_SOURCE_DEFAULT;
  // 退一步：来源星球：XXX / 来源：XXX
  let m = /来源星球[：:]\s*([^\n（(｜|]+)/.exec(head) || /数据来源[：:]\s*([^\n（(｜|]+)/.exec(head) || /来源[：:]\s*([^\n（(｜|]+)/.exec(head);
  if (m) {
    return m[1].replace(/[「『」』（）()]/g, '').replace(/知识星球/g, '').trim() || SITE_SOURCE_DEFAULT;
  }
  return SITE_SOURCE_DEFAULT;
}

/** 标签拼成 "#TAX #AI" 展示串。 */
function tagsDisplay(tags) {
  return tags.map((t) => `#${t}`).join(' ');
}

/* ------------------------------------------------------------------ *
 * HTML 片段
 * ------------------------------------------------------------------ */

/** 防闪烁主题初始化脚本（内联进 <head>，开画前设好 dataset.theme）。 */
const THEME_INIT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('nbq-theme');" +
  "if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}" +
  "document.documentElement.dataset.theme=t;}catch(e){}})();";

/** RSS 图标（小内联 SVG，禁止图标字体/CDN）。 */
const RSS_SVG =
  '<svg class="icon icon-rss" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M6.18 17.82a2.18 2.18 0 1 1-4.36 0 2.18 2.18 0 0 1 4.36 0zM2 9.91v2.84c4.55 0 8.25 3.7 8.25 8.25h2.84C13.09 14.76 8.24 9.91 2 9.91zm0-4.91v2.84c7.27 0 13.16 5.89 13.16 13.16H18C18 12.07 10.93 5 2 5z"/>' +
  '</svg>';

/** 主题切换按钮内联日/月图标（CSS 依 data-theme 控制显隐；app.js 兜底 hidden）。 */
const THEME_ICONS =
  // 月亮（浅色模式显示，点它切到深色）
  '<svg class="icon icon-moon" data-icon="moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
  // 太阳（深色模式显示，点它切回浅色）
  '<svg class="icon icon-sun" data-icon="sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" hidden>' +
  '<path fill="currentColor" d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1zm0 14a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1zM5 12a1 1 0 0 1-1 1H3a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zm17 0a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1zM6.34 6.34a1 1 0 0 1 0 1.41l-.7.71a1 1 0 1 1-1.42-1.42l.71-.7a1 1 0 0 1 1.41 0zm12.02 12.02a1 1 0 0 1 0 1.41l-.71.71a1 1 0 0 1-1.41-1.42l.7-.7a1 1 0 0 1 1.42 0zM6.34 17.66a1 1 0 0 1-1.41 0l-.71-.71a1 1 0 0 1 1.42-1.41l.7.7a1 1 0 0 1 0 1.42zM18.36 5.64a1 1 0 0 1-1.42 0l-.7-.71a1 1 0 0 1 1.41-1.41l.71.7a1 1 0 0 1 0 1.42z"/></svg>';

/** 站点页头（两页通用）。isArticle=true 时含「全部」返回链接。 */
function siteHeader(isArticle) {
  const back = isArticle
    ? '\n    <a class="nav-back" href="./index.html">全部</a>'
    : '';
  return `<header class="site-header">
  <a class="site-name" href="./index.html">南半球聊财经<span class="site-name-en"> 每日 Summary</span></a>
  <nav class="site-nav">${back}
    <a class="rss-link" href="./feed.xml" aria-label="RSS 订阅">${RSS_SVG}</a>
    <button class="theme-toggle" type="button" aria-label="切换深色模式" aria-pressed="false">${THEME_ICONS}</button>
  </nav>
</header>`;
}

/** 站点页脚（首页与文章页底部的站点级 footer）。 */
function siteFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <p class="footer-disclaimer">本站内容为对公开财经帖子的个人学习性解读，仅供参考，不构成任何投资建议。据此操作，风险自负。</p>
  <p class="footer-meta">
    <span>© ${year} ${esc(SITE_NAME)}</span>
    <a class="footer-rss" href="./feed.xml" aria-label="RSS 订阅">${RSS_SVG}<span> RSS 订阅</span></a>
  </p>
</footer>`;
}

/** 通用 <head>（§4.1）。relCanonical = 形如 index.html / 2026-06-14.html。 */
function pageHead({ title, description, canonicalPath, ogType }) {
  const canonical = `${SITE_URL}/${canonicalPath}`;
  // 仅加载 Inter（+ 可选 JetBrains Mono）；不加载中文 webfont。
  const fontsHref =
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(description)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${escAttr(SITE_NAME)}">
<link rel="canonical" href="${escAttr(canonical)}">
<meta property="og:url" content="${escAttr(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(SITE_NAME)}" href="./feed.xml">
<link rel="icon" type="image/svg+xml" href="./favicon.svg">
<script>${THEME_INIT_SCRIPT}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${escAttr(fontsHref)}">
<link rel="stylesheet" href="./styles.css">
</head>`;
}

/* ------------------------------------------------------------------ *
 * 页面生成
 * ------------------------------------------------------------------ */

/** 首页 index.html（§4.3）。 */
function renderIndex(posts) {
  const items = posts.map((p) => {
    // data-search：小写、空格分隔的可搜索串（日期 + 标题 + 预览 + 标签）
    const searchParts = [
      p.date,
      dotDate(p.date),
      p.title,
      p.preview,
      p.tags.join(' '),
      tagsDisplay(p.tags),
    ].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();

    const metaSpans = [];
    if (p.postCount > 0) metaSpans.push(`<span>${p.postCount} 帖</span>`);
    metaSpans.push(`<span>约 ${p.minutes} 分钟</span>`);
    if (p.tags.length) metaSpans.push(`<span class="feed-tags">${esc(tagsDisplay(p.tags))}</span>`);

    const thumb = p.thumb
      ? `\n        <div class="feed-thumb"><img loading="lazy" src="${escAttr(p.thumb)}" alt=""></div>`
      : '';

    const previewHtml = p.preview
      ? `\n          <p class="feed-preview">${esc(p.preview)}</p>`
      : '';

    return `    <article class="feed-item" data-search="${escAttr(searchParts)}">
      <a class="feed-item-link" href="./${escAttr(p.date)}.html">
        <div class="feed-item-text">
          <div class="feed-date">${esc(dotDate(p.date))}</div>
          <h2 class="feed-title">${esc(p.title)}</h2>${previewHtml}
          <div class="feed-meta">${metaSpans.join('')}</div>
        </div>${thumb}
      </a>
    </article>`;
  }).join('\n');

  const head = pageHead({
    title: SITE_NAME,
    description: SITE_TAGLINE,
    canonicalPath: 'index.html',
    ogType: 'website',
  });

  return `${head}
<body>
${siteHeader(false)}
<section class="masthead">
  <h1 class="masthead-title">南半球聊财经<span class="site-name-en"> 每日 Summary</span></h1>
  <p class="masthead-tagline">${esc(SITE_TAGLINE)}</p>
</section>
<div class="feed-tools">
  <input id="feed-filter" class="feed-filter" type="search" placeholder="按日期或关键词筛选…" aria-label="筛选">
</div>
<main class="feed">
${items}
</main>
${siteFooter()}
<script src="./app.js" defer></script>
</body>
</html>
`;
}

/** 文章页 <date>.html（§4.4）。 */
function renderArticle(post, prev, next) {
  // 文章级 meta：2026 · 06 · 01　·　来源星球 XXX　·　10 帖　·　约 9 分钟
  const metaBits = [dotDate(post.date)];
  if (post.source) metaBits.push(`来源星球 ${post.source}`);
  if (post.postCount > 0) metaBits.push(`${post.postCount} 帖`);
  metaBits.push(`约 ${post.minutes} 分钟`);
  const metaLine = metaBits.join('　·　');

  const tocItems = post.toc.map((t) =>
    `      <li><a href="#${escAttr(t.id)}">${esc(t.text || t.id)}</a></li>`
  ).join('\n');
  const tocBlock = post.toc.length
    ? `  <nav class="toc" aria-label="本期目录">
    <button class="toc-toggle" type="button" aria-expanded="false">本期目录</button>
    <ol class="toc-list">
${tocItems}
    </ol>
  </nav>
`
    : '';

  let prevLink = '';
  let nextLink = '';
  if (prev) prevLink = `    <a class="post-nav-prev" href="./${escAttr(prev.date)}.html">← ${esc(shortDate(prev.date))}</a>\n`;
  if (next) nextLink = `    <a class="post-nav-next" href="./${escAttr(next.date)}.html">${esc(shortDate(next.date))} →</a>\n`;
  const postNav = (prev || next)
    ? `  <nav class="post-nav">\n${prevLink}${nextLink}  </nav>\n`
    : '';

  const head = pageHead({
    title: `${post.title} — ${SITE_NAME}`,
    description: post.preview || SITE_TAGLINE,
    canonicalPath: `${post.date}.html`,
    ogType: 'article',
  });

  return `${head}
<body>
${siteHeader(true)}
<main class="article">
  <div class="article-meta">${esc(metaLine)}</div>
  <h1 class="article-title">${esc(post.title)}</h1>
${tocBlock}  <div class="article-body">
${post.bodyHtml}
  </div>
${postNav}  <footer class="article-footer">
    <p>本文为对公开财经帖子的个人学习性解读，仅供参考，不构成任何投资建议。据此操作，风险自负。</p>
  </footer>
</main>
${siteFooter()}
<script src="./app.js" defer></script>
</body>
</html>
`;
}

/** feed.xml（§5.10）：最近 ~30 篇，绝对链接用 SITE_URL。 */
function renderFeed(posts) {
  const recent = posts.slice(0, 30);
  const now = new Date().toUTCString();
  const itemsXml = recent.map((p) => {
    const link = `${SITE_URL}/${p.date}.html`;
    const desc = p.preview || SITE_TAGLINE;
    return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <description>${esc(desc)}</description>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(SITE_NAME)}</title>
    <link>${esc(SITE_URL + '/')}</link>
    <description>${esc(SITE_TAGLINE)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}
  </channel>
</rss>
`;
}

// 去掉正文最开头那条一级标题（# ...）——它与页面大标题 .article-title 重复，
// 且常含旧名「Jason 不跪 每日帖子深入解读」，故不在正文重复展示。
function stripLeadingH1(md) {
  return md.replace(/^﻿?\s*#[ \t]+.*(?:\r?\n)+/, '');
}

// 帖内小标签分类（一句话核心 / 图片解读 / 为什么重要 / 延伸知识 …）→ 类型或 null。
function classifyLabel(t) {
  const s = t.trim();
  if (/^一句话/.test(s)) return 'core';
  if (/^原文/.test(s)) return 'source';
  if (/^(背景|关键数据|数据梳理)/.test(s)) return 'data';
  if (/^(图片解读|图表解读|图解)/.test(s)) return 'image';
  if (/^(为什么重要|为何重要|对市场|对经济|市场含义|经济含义|投资含义|含义与影响)/.test(s)) return 'why';
  if (/^(延伸知识|延伸阅读|知识延伸)/.test(s)) return 'learn';
  return null;
}

// 把「<p><strong>已知小标签</strong>」标成可着色小标题（仅命中已知标签，避免误伤普通加粗）。
function tagPostLabels(html) {
  return html.replace(/<p><strong>([^<]{1,40}?)<\/strong>/g, (m, text) => {
    const type = classifyLabel(text);
    return type
      ? `<p class="ps ps--${type}"><strong class="post-label">${text}</strong>`
      : m;
  });
}

/* ------------------------------------------------------------------ *
 * 单篇解析
 * ------------------------------------------------------------------ */
function parsePost(filePath, date, mdLib) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // 1) 抽 base64 图（替换为相对路径；HTML 内不残留 data:image）
  const { md: mdNoB64, images, count: imgCount } = extractImages(raw, date);

  // 2) 渲染 + h2 注入 id + TOC（去重复 H1）+ 帖内小标题着色
  const { html: renderedBody, toc } = renderWithToc(stripLeadingH1(mdNoB64), mdLib);
  const bodyHtml = tagPostLabels(renderedBody);

  // 3) 各类提取（基于已抽图的 markdown）
  const overview = extractOverviewBlock(mdNoB64);
  const title = extractTitle(mdNoB64, overview, date);
  const preview = extractPreview(overview);
  const postCount = extractPostCount(mdNoB64);
  const plainAll = stripMarkdown(mdNoB64);
  const minutes = readingMinutes(plainAll);
  const tags = extractTags(mdNoB64);
  const source = extractSource(raw);

  return {
    date,
    title,
    preview,
    postCount,
    minutes,
    tags,
    source,
    toc,
    bodyHtml,
    images,
    imgCount,
    thumb: images.length ? images[0] : null,
  };
}

/* ------------------------------------------------------------------ *
 * 复制 styles.css / app.js（不存在则跳过 + 告警）
 * ------------------------------------------------------------------ */
function copyAsset(name) {
  const from = path.join(SRC_ASSETS, name);
  const to = path.join(OUT_DIR, name);
  if (!fs.existsSync(from)) {
    console.warn(`  [warn] src/${name} 尚不存在，跳过复制（可能由其它 agent 后续生成）。`);
    return false;
  }
  fs.copyFileSync(from, to);
  console.log(`  复制 src/${name} → docs/${name}`);
  return true;
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
function main() {
  console.log('=== 南半球聊财经每日Summary 构建 ===');
  console.log(`源目录：${SRC_DIR}`);
  console.log(`输出：${OUT_DIR}`);
  console.log(`SITE_URL：${SITE_URL}`);

  if (!fs.existsSync(SRC_DIR)) {
    console.error(`[fatal] 源目录不存在：${SRC_DIR}`);
    process.exit(1);
  }

  // 确保输出目录结构
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(ASSETS_DIR, { recursive: true, force: true }); // 清掉上次构建的旧图，避免孤儿残留
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  // 1) 收集匹配文件，按日期降序
  const entries = fs.readdirSync(SRC_DIR)
    .map((name) => {
      const m = FILE_RE.exec(name);
      return m ? { name, date: m[1], path: path.join(SRC_DIR, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // 降序

  console.log(`匹配到 ${entries.length} 篇 jason_解读 文档。`);
  if (!entries.length) {
    console.warn('[warn] 没有匹配的源文档，仍会生成空首页与 feed。');
  }

  const mdLib = makeRenderer();
  installLazyImages(mdLib);

  // 2) 逐篇解析（单篇 try/catch 跳过不中断）
  const posts = [];
  for (const e of entries) {
    try {
      const post = parsePost(e.path, e.date, mdLib);
      posts.push(post);
      console.log(`  ✓ ${e.date}　标题「${post.title}」　图 ${post.imgCount}　帖 ${post.postCount}　约 ${post.minutes} 分钟`);
    } catch (err) {
      console.error(`  ✗ ${e.date} 解析失败，已跳过：${err && err.stack ? err.stack : err}`);
    }
  }

  // posts 已是降序（entries 降序 + 顺序 push）。相邻导航定义：
  //   数组按日期【降序】排列：posts[i-1] 比 posts[i] 新，posts[i+1] 比 posts[i] 旧。
  //   "上一篇" = 时间更早 = posts[i+1]；"下一篇" = 时间更晚 = posts[i-1]。
  let articleCount = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const prev = posts[i + 1] || null; // 更早
    const next = posts[i - 1] || null; // 更晚
    try {
      const html = renderArticle(post, prev, next);
      fs.writeFileSync(path.join(OUT_DIR, `${post.date}.html`), html, 'utf8');
      articleCount += 1;
    } catch (err) {
      console.error(`  ✗ ${post.date} 写页失败，已跳过：${err && err.stack ? err.stack : err}`);
    }
  }

  // 3) 首页 + feed
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderIndex(posts), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'feed.xml'), renderFeed(posts), 'utf8');

  // 4) 复制 styles.css / app.js（不存在则告警跳过）
  copyAsset('styles.css');
  copyAsset('app.js');
  copyAsset('favicon.svg');

  // 5) 汇总
  const totalImgs = posts.reduce((s, p) => s + p.imgCount, 0);
  console.log('--- 构建完成 ---');
  console.log(`文章页：${articleCount} / ${posts.length}`);
  console.log(`首页：docs/index.html`);
  console.log(`Feed：docs/feed.xml（含 ${Math.min(posts.length, 30)} 篇）`);
  console.log(`抽出图片：${totalImgs} 张`);
}

main();
