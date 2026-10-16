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
 *   - .site-header / body.bar-hidden / body.scrolled   手机顶栏：下滑收起、滚动后加底色
 *   - .app-search / .app-toc   手机顶栏按钮：聚焦搜索框 / 打开目录抽屉（.toc-scrim 遮罩）
 *   - .chip-row .chip[data-filter] + .sec[data-sec]   AI 八卦分类筛选
 *   - .expand-all + details.pcard   南半球「全部展开」
 *   - meta[name=theme-color]   手动切主题时同步状态栏颜色
 *   - sw.js                    离线缓存（装到主屏幕后可离线读）
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
    // 状态栏 / 任务切换器的颜色跟着页面底色走
    var bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) if (bg) metas[i].setAttribute('content', bg);
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

    // 缩放/平移状态：图片始终以中心为基准缩放，放大后可拖动平移。
    var scale = 1, tx = 0, ty = 0;
    var MIN = 1, MAX = 6;
    var dragging = false, moved = false, sx = 0, sy = 0, stx = 0, sty = 0;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function applyTransform() {
      if (!overlayImg) return;
      overlayImg.style.transform =
        'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      overlayImg.style.cursor =
        scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in';
    }

    function resetView() { scale = 1; tx = 0; ty = 0; applyTransform(); }

    function zoomBy(factor) {
      var ns = clamp(scale * factor, MIN, MAX);
      if (ns === scale) return;
      scale = ns;
      if (scale === 1) { tx = 0; ty = 0; } // 回到 1x 自动复位居中
      applyTransform();
    }

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

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lightbox-close';
      closeBtn.setAttribute('aria-label', '关闭');
      closeBtn.innerHTML = '&times;';
      overlay.appendChild(closeBtn);

      var hint = document.createElement('div');
      hint.className = 'lightbox-hint';
      hint.textContent = coarse ? '双指缩放 · 下滑关闭 · 双击复位' : '滚轮缩放 · 拖动平移 · 双击复位 · Esc 关闭';
      overlay.appendChild(hint);

      // 滚轮：以中心为基准放大/缩小（图片留在中央）。
      overlay.addEventListener('wheel', function (e) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });

      // 放大后按住拖动平移。
      overlayImg.addEventListener('mousedown', function (e) {
        if (scale <= 1) return;
        e.preventDefault();
        dragging = true; moved = false;
        sx = e.clientX; sy = e.clientY; stx = tx; sty = ty;
        applyTransform();
      });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        tx = stx + (e.clientX - sx);
        ty = sty + (e.clientY - sy);
        if (Math.abs(e.clientX - sx) > 3 || Math.abs(e.clientY - sy) > 3) moved = true;
        applyTransform();
      });
      window.addEventListener('mouseup', function () {
        if (dragging) { dragging = false; applyTransform(); }
      });

      // 单击图片：适配态 → 放大进入（居中）；已放大时单击不再继续放大，
      // 缩放交给滚轮、复位交给双击。拖动结束的 mouseup 不当作点击。
      overlayImg.addEventListener('click', function (e) {
        e.stopPropagation();
        if (moved) { moved = false; return; }
        if (scale <= 1) zoomBy(2);
      });
      overlayImg.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        resetView();
      });
      // 点背景空白处：关闭。
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeLightbox();
      });
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeLightbox();
      });

      initTouch();
      document.body.appendChild(overlay);
      return overlay;
    }

    // 触摸：双指缩放；放大后单指平移；没放大时单指下滑超过 120px 关闭（跟手移动、背景渐隐）。
    function initTouch() {
      var pts = {};
      var pinch0 = 0, scale0 = 1, swipeY = 0, swiping = false;
      function dist() {
        var k = Object.keys(pts);
        if (k.length < 2) return 0;
        var a = pts[k[0]], b = pts[k[1]];
        return Math.hypot(a.x - b.x, a.y - b.y);
      }
      overlay.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'touch') return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var n = Object.keys(pts).length;
        if (n === 2) { pinch0 = dist(); scale0 = scale; swiping = false; }
        if (n === 1) { sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; swipeY = 0; swiping = scale <= 1; }
      });
      overlay.addEventListener('pointermove', function (e) {
        if (!pts[e.pointerId]) return;
        pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var n = Object.keys(pts).length;
        if (n === 2 && pinch0) {
          scale = clamp(scale0 * dist() / pinch0, MIN, MAX);
          if (scale === 1) { tx = 0; ty = 0; }
          moved = true;
          applyTransform();
        } else if (n === 1 && scale > 1) {
          tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy);
          moved = true;
          applyTransform();
        } else if (n === 1 && swiping) {
          swipeY = Math.max(0, e.clientY - sy);
          if (swipeY > 4) moved = true;
          overlayImg.style.transform = 'translateY(' + swipeY + 'px)';
          overlay.style.backgroundColor = 'rgba(0,0,0,' + Math.max(0.2, 0.85 - swipeY / 400) + ')';
        }
      });
      function end(e) {
        if (!pts[e.pointerId]) return;
        delete pts[e.pointerId];
        if (Object.keys(pts).length < 2) pinch0 = 0;
        if (swiping && Object.keys(pts).length === 0) {
          swiping = false;
          overlay.style.backgroundColor = '';
          if (swipeY > 120) { closeLightbox(); } else { applyTransform(); }
        }
      }
      overlay.addEventListener('pointerup', end);
      overlay.addEventListener('pointercancel', end);
    }

    function openLightbox(srcImg) {
      ensureOverlay();
      // 用图片自身 src（已是抽出的全分辨率原图）；如有 data-full 则优先。
      var full =
        srcImg.getAttribute('data-full') ||
        srcImg.currentSrc ||
        srcImg.src;
      overlayImg.src = full;
      overlayImg.alt = srcImg.alt || '';
      resetView(); // 每次打开回到适配、居中
      overlay.classList.add('lightbox--open');
      document.documentElement.classList.add('lightbox-open'); // 锁背景滚动
      document.addEventListener('keydown', onKeydown);
    }

    function closeLightbox() {
      if (!overlay) return;
      overlay.classList.remove('lightbox--open');
      document.documentElement.classList.remove('lightbox-open');
      document.removeEventListener('keydown', onKeydown);
      resetView();
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
   * 5. 手机顶栏：往下滑收起、往上滑出现；离开顶部后加底色（Material 顶栏）
   * ------------------------------------------------------------------ */
  function initAppBar() {
    var mq = window.matchMedia('(max-width: 640px)');
    var body = document.body;
    var lastY = window.scrollY, ticking = false;
    function update() {
      ticking = false;
      var y = window.scrollY;
      body.classList.toggle('scrolled', y > 4);
      if (!mq.matches || document.documentElement.classList.contains('lightbox-open')) {
        body.classList.remove('bar-hidden');
      } else if (y > lastY + 6 && y > 120) {
        body.classList.add('bar-hidden');
      } else if (y < lastY - 6 || y < 120) {
        body.classList.remove('bar-hidden');
      }
      lastY = y;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------ *
   * 6. 手机顶栏按钮：搜索聚焦筛选框；目录打开底部抽屉
   * ------------------------------------------------------------------ */
  function initAppActions() {
    var search = document.querySelector('.app-search');
    var filter = document.getElementById('feed-filter');
    if (search && filter) {
      search.addEventListener('click', function () {
        filter.scrollIntoView({ block: 'center', behavior: 'smooth' });
        filter.focus({ preventScroll: true });
      });
    }

    var btn = document.querySelector('.app-toc');
    var toc = document.querySelector('.toc');
    if (!btn || !toc) return;
    var scrim = document.createElement('div');
    scrim.className = 'toc-scrim';
    document.body.appendChild(scrim);
    var toggle = toc.querySelector('.toc-toggle');
    function setOpen(open) {
      toc.classList.toggle('toc--open', open);
      scrim.classList.toggle('is-on', open);
      if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    btn.addEventListener('click', function () { setOpen(!toc.classList.contains('toc--open')); });
    scrim.addEventListener('click', function () { setOpen(false); });
    // 抽屉里点了目录项就收起（宽屏的目录不受影响）
    toc.addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 640px)').matches) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && scrim.classList.contains('is-on')) setOpen(false);
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. AI 八卦分类筛选：点一个分类只看那一节，点「全部」恢复
   * ------------------------------------------------------------------ */
  function initChips() {
    var row = document.querySelector('.chip-row');
    if (!row) return;
    var chips = row.querySelectorAll('.chip');
    var secs = document.querySelectorAll('.article-body .sec');
    row.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var f = chip.getAttribute('data-filter');
      for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('is-on', chips[i] === chip);
      for (var j = 0; j < secs.length; j++) {
        secs[j].hidden = f !== 'all' && secs[j].getAttribute('data-sec') !== f;
      }
      chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      var top = row.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(row).top) || 0);
      if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
    });
  }

  /* ------------------------------------------------------------------ *
   * 8. 南半球「全部展开 / 全部收起」
   * ------------------------------------------------------------------ */
  function initExpandAll() {
    var btn = document.querySelector('.expand-all');
    if (!btn) return;
    var cards = document.querySelectorAll('details.pcard');
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-pressed') !== 'true';
      for (var i = 0; i < cards.length; i++) cards[i].open = open;
      btn.setAttribute('aria-pressed', open ? 'true' : 'false');
      btn.textContent = open ? '全部收起' : '全部展开';
    });
  }

  /* ------------------------------------------------------------------ *
   * 9. 离线缓存：注册站点根目录的 sw.js（作用域 = 整个 prism）
   * ------------------------------------------------------------------ */
  function initServiceWorker(scriptSrc) {
    if (!('serviceWorker' in navigator) || !scriptSrc || location.protocol !== 'https:') return;
    var base = new URL('.', scriptSrc).href;
    navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(function () {});
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  var SCRIPT_SRC = document.currentScript && document.currentScript.src;

  function init() {
    initTheme();
    initFeedFilter();
    initToc();
    initLightbox();
    initAppBar();
    initAppActions();
    initChips();
    initExpandAll();
    initServiceWorker(SCRIPT_SRC);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // defer 脚本通常在 DOMContentLoaded 前执行完毕，但直接 readyState 检查更稳妥。
    init();
  }
})();
