/*
 * 南半球聊财经每日Summary — 客户端交互
 * 原生 JS · 零依赖 · 无需构建
 *
 * 契约（spec §4.5 / §4.2 / §4.3 / §4.4）依赖的类名/ID：
 *   - .theme-toggle            主题切换按钮（页头）
 *   - .theme-toggle 内 inline SVG 用 [data-icon="sun"] / [data-icon="moon"] 标记日/月图标
 *   - #feed-filter             首页筛选输入框
 *   - .feed-item[data-search]  首页信息流条目（data-search = 小写空格分隔的可搜索串）
 *   - .toc                     文章页目录容器（折叠态切换 .toc--open）
 *   - .toc-toggle              目录折叠按钮（维护 aria-expanded）
 *   - .article-body img        文章正文图片（点击弹灯箱）
 *   - .lightbox / .lightbox--open   灯箱覆盖层（JS 动态创建，CSS 提供样式，默认隐藏）
 *
 * localStorage key：'nbq-theme'（值 'light' | 'dark'）
 *
 * 设计原则：所有功能各自独立、元素不存在时静默跳过；
 * 同一份 app.js 在首页与文章页通用（首页没有 .toc / .article-body，
 * 文章页没有 #feed-filter），缺哪段就跳过哪段。
 */
(function () {
  'use strict';

  var THEME_KEY = 'nbq-theme';
  var root = document.documentElement;

  /* ------------------------------------------------------------------ *
   * 1. 主题切换
   *    <head> 已有同步脚本做防闪烁初始化（开画前设好 dataset.theme）；
   *    这里只负责点击切换 + 持久化 + 图标显隐。
   * ------------------------------------------------------------------ */
  function currentTheme() {
    // 以 <head> 防闪烁脚本设定的 dataset.theme 为准；缺失时按系统偏好兜底。
    if (root.dataset.theme === 'light' || root.dataset.theme === 'dark') {
      return root.dataset.theme;
    }
    var prefersDark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  }

  function applyTheme(theme, toggleBtn) {
    root.dataset.theme = theme;
    // 图标显隐主要由 CSS 依据 [data-theme] 控制；这里同步 aria 状态，
    // 并对按钮内 inline SVG 图标做一次防御性显隐（CSS 未覆盖时仍可用）。
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      var sun = toggleBtn.querySelector('[data-icon="sun"]');
      var moon = toggleBtn.querySelector('[data-icon="moon"]');
      // 深色模式下显示「太阳」(点它回到浅色)，浅色模式下显示「月亮」。
      if (sun) sun.hidden = theme !== 'dark';
      if (moon) moon.hidden = theme === 'dark';
    }
  }

  function initTheme() {
    var toggleBtn = document.querySelector('.theme-toggle');
    // 即便没有按钮，也用现有主题刷新一次 aria（按钮可能后续不存在，安全跳过）。
    applyTheme(currentTheme(), toggleBtn);
    if (!toggleBtn) return; // 防御：无切换按钮则跳过事件绑定

    toggleBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next, toggleBtn);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* localStorage 不可用（隐私模式等）时静默忽略 */
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. 首页筛选
   *    #feed-filter 输入 → 按 .feed-item[data-search] 是否 includes
   *    小写查询来显隐。
   * ------------------------------------------------------------------ */
  function initFeedFilter() {
    var input = document.getElementById('feed-filter');
    if (!input) return; // 防御：文章页没有筛选框

    var items = document.querySelectorAll('.feed-item');
    if (!items.length) return;

    function applyFilter() {
      var q = input.value.toLowerCase().trim();
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var hay = (item.getAttribute('data-search') || '').toLowerCase();
        // 空查询 → 全部显示；否则按子串匹配。
        var show = q === '' || hay.indexOf(q) !== -1;
        item.hidden = !show;
      }
    }

    input.addEventListener('input', applyFilter);
    applyFilter(); // 进入页面（含浏览器回填的输入值）时跑一次
  }

  /* ------------------------------------------------------------------ *
   * 3. 目录折叠
   *    .toc-toggle 点击 → 切换 .toc 的 toc--open，并维护 aria-expanded。
   *    初始展开/折叠态由 CSS 媒体查询控制；JS 只把 aria-expanded 与
   *    实际类名同步，再处理点击切换。
   * ------------------------------------------------------------------ */
  function initToc() {
    var toggle = document.querySelector('.toc-toggle');
    if (!toggle) return; // 防御：首页没有目录

    var toc = toggle.closest('.toc') || document.querySelector('.toc');
    if (!toc) return;

    // 与当前类名同步初始 aria-expanded（窄屏 CSS 默认折叠 / 宽屏展开）。
    toggle.setAttribute(
      'aria-expanded',
      toc.classList.contains('toc--open') ? 'true' : 'false'
    );

    toggle.addEventListener('click', function () {
      var open = toc.classList.toggle('toc--open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. 图片灯箱
   *    点击 .article-body img → 动态创建 .lightbox 覆盖层（含大图）；
   *    点击覆盖层或按 Esc 关闭（切换 lightbox--open）。
   * ------------------------------------------------------------------ */
  function initLightbox() {
    var body = document.querySelector('.article-body');
    if (!body) return; // 防御：首页没有文章正文

    var overlay = null; // 复用单一覆盖层
    var overlayImg = null;

    function ensureOverlay() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.className = 'lightbox';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '图片放大查看');

      overlayImg = document.createElement('img');
      overlayImg.className = 'lightbox-img';
      overlayImg.alt = '';
      overlay.appendChild(overlayImg);

      // 点击覆盖层任意处（含图片）即关闭。
      overlay.addEventListener('click', closeLightbox);

      document.body.appendChild(overlay);
      return overlay;
    }

    function openLightbox(srcImg) {
      ensureOverlay();
      // 优先用全分辨率原图（若有 data-full），否则用 img 自身 src。
      var full =
        srcImg.getAttribute('data-full') ||
        srcImg.currentSrc ||
        srcImg.src;
      overlayImg.src = full;
      overlayImg.alt = srcImg.alt || '';
      overlay.classList.add('lightbox--open');
      document.addEventListener('keydown', onKeydown);
    }

    function closeLightbox() {
      if (!overlay) return;
      overlay.classList.remove('lightbox--open');
      document.removeEventListener('keydown', onKeydown);
      // 释放大图引用，避免占用内存（base64/大图常见）。
      if (overlayImg) overlayImg.removeAttribute('src');
    }

    function onKeydown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeLightbox();
      }
    }

    // 事件委托：正文图片可能很多，统一在容器上监听。
    body.addEventListener('click', function (e) {
      var target = e.target;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
        openLightbox(target);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function init() {
    initTheme();
    initFeedFilter();
    initToc();
    initLightbox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // defer 脚本通常在 DOMContentLoaded 前执行完毕，但直接 readyState 检查更稳妥。
    init();
  }
})();
