/*
 * lp-cart.js — shared purchase state for all LP sections (hero buy box, purchase section, sticky bar).
 * One store holds { variant, quantity }; every [data-lp-form] reads and writes it, so the main and
 * sticky controls always agree. Adds to cart via Shopify's Ajax Cart API (/cart/add.js) and hands the
 * response to Dawn's cart-notification / cart-drawer when present.
 * No dependencies. Safe to include from multiple sections (guards against double init).
 */
(function () {
  if (window.LPCart) return;

  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var store = { product: null, variant: null, quantity: 1, moneyFormat: '{{amount}}', listeners: [] };

  // ---------- money ----------
  function formatMoney(cents, format) {
    if (typeof cents === 'string') cents = cents.replace('.', '');
    cents = parseInt(cents, 10) || 0;
    var fmt = format || store.moneyFormat || '{{amount}}';
    function delimit(num, precision, thousands, decimal) {
      var fixed = (num / 100).toFixed(precision);
      var parts = fixed.split('.');
      var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
      return parts[1] ? whole + decimal + parts[1] : whole;
    }
    var match = fmt.match(/\{\{\s*(\w+)\s*\}\}/);
    var key = match ? match[1] : 'amount';
    var value;
    switch (key) {
      case 'amount_no_decimals': value = delimit(cents, 0, ',', '.'); break;
      case 'amount_with_comma_separator': value = delimit(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = delimit(cents, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': value = delimit(cents, 2, "'", '.'); break;
      default: value = delimit(cents, 2, ',', '.');
    }
    // money_format may contain HTML (e.g. <span class=money>); strip tags for textContent use
    return fmt.replace(/\{\{\s*\w+\s*\}\}/, value).replace(/<[^>]*>/g, '');
  }

  // ---------- state ----------
  function findVariant(options) {
    var vs = store.product.variants;
    for (var i = 0; i < vs.length; i++) {
      var ok = true;
      for (var j = 0; j < options.length; j++) if (vs[i].options[j] !== options[j]) { ok = false; break; }
      if (ok) return vs[i];
    }
    return null;
  }
  function setState(patch, source) {
    if ('variant' in patch) store.variant = patch.variant;
    if ('quantity' in patch) store.quantity = Math.max(1, Math.min(999, parseInt(patch.quantity, 10) || 1));
    store.listeners.forEach(function (fn) { fn(store, source); });
  }
  function subscribe(fn) { store.listeners.push(fn); }

  // ---------- rendering ----------
  function renderForm(form) {
    var v = store.variant;
    var p = store.product;
    var each = function (sel, fn) { Array.prototype.forEach.call(form.querySelectorAll(sel), fn); };
    var input = form.querySelector('[data-lp-variant-input]');
    if (input) input.value = v ? v.id : '';

    each('[data-lp-price]', function (el) { el.textContent = v ? formatMoney(v.price) : ''; });
    each('[data-lp-compare]', function (el) {
      var show = v && v.compare_at_price && v.compare_at_price > v.price;
      el.hidden = !show;
      if (show) el.textContent = formatMoney(v.compare_at_price);
    });
    each('[data-lp-save]', function (el) {
      var show = v && v.compare_at_price && v.compare_at_price > v.price;
      el.hidden = !show;
      if (show) el.textContent = (el.dataset.label || 'Save') + ' ' + Math.round((1 - v.price / v.compare_at_price) * 100) + '%';
    });
    each('[data-lp-variant-title]', function (el) {
      el.textContent = v ? (p.variants.length > 1 ? v.title : '') : (el.dataset.unavailable || 'Unavailable');
    });
    each('[data-lp-qty]', function (el) { if (document.activeElement !== el) el.value = store.quantity; });
    each('[data-lp-option]', function (el) {
      var idx = parseInt(el.dataset.lpOption, 10);
      if (el.type === 'radio') {
        if (v) el.checked = v.options[idx] === el.value;
        // mark values that have no available variant given the other current selections
        var trial = currentOptions(form).slice();
        trial[idx] = el.value;
        var tv = findVariant(trial);
        var label = form.querySelector('label[for="' + el.id + '"]');
        if (label) label.classList.toggle('is-unavailable', !tv || !tv.available);
      } else if (v && el.tagName === 'SELECT') {
        el.value = v.options[idx];
      }
    });
    each('[data-lp-opt-label]', function (el) {
      var idx = parseInt(el.dataset.lpOptLabel, 10);
      if (v) el.textContent = v.options[idx];
    });
    each('[data-lp-atc]', function (btn) {
      var label = btn.querySelector('[data-lp-atc-label]') || btn;
      if (!v) { btn.disabled = true; label.textContent = btn.dataset.unavailable || 'Unavailable'; }
      else if (!v.available) { btn.disabled = true; label.textContent = btn.dataset.soldout || 'Sold out'; }
      else if (!btn.classList.contains('is-loading')) { btn.disabled = false; label.textContent = btn.dataset.label || 'Add to cart'; }
    });
  }
  function currentOptions(form) {
    var opts = store.variant ? store.variant.options.slice() : [];
    Array.prototype.forEach.call(form.querySelectorAll('[data-lp-option]'), function (el) {
      var idx = parseInt(el.dataset.lpOption, 10);
      if ((el.type === 'radio' && el.checked) || el.tagName === 'SELECT') opts[idx] = el.value;
    });
    return opts;
  }
  function syncUrl() {
    if (!store.variant || !window.history || !window.history.replaceState) return;
    try {
      var url = new URL(window.location.href);
      url.searchParams.set('variant', store.variant.id);
      window.history.replaceState({}, '', url.toString());
    } catch (e) { /* ignore */ }
  }

  // ---------- add to cart ----------
  function status(form, msg, kind) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-lp-status]'), function (el) {
      el.textContent = msg || '';
      el.dataset.kind = kind || '';
      el.hidden = !msg;
    });
  }
  function dawnCart() { return document.querySelector('cart-notification') || document.querySelector('cart-drawer'); }

  function addToCart(form, btn) {
    var v = store.variant;
    if (!v) { status(form, 'This combination is unavailable. Please choose different options.', 'error'); return; }
    if (!v.available) { status(form, 'Sorry, this option is sold out.', 'error'); return; }
    var cart = dawnCart();
    var body = { id: v.id, quantity: store.quantity };
    if (cart && cart.getSectionsToRender) {
      body.sections = cart.getSectionsToRender().map(function (s) { return s.id; });
      body.sections_url = window.location.pathname;
      if (cart.setActiveElement) cart.setActiveElement(document.activeElement);
    }
    btn.classList.add('is-loading');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    status(form, '', '');

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);

    fetch(root + 'cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
      })
      .then(function (r) {
        if (!r.ok || r.data.status) {
          var msg = (r.data && (r.data.description || r.data.message)) || 'Could not add to cart (error ' + r.status + ').';
          status(form, msg, 'error');
          document.dispatchEvent(new CustomEvent('lp:cart:error', { detail: { variantId: v.id, message: msg } }));
          return;
        }
        document.dispatchEvent(new CustomEvent('lp:cart:added', { detail: { variantId: v.id, quantity: store.quantity, item: r.data } }));
        if (window.publish && window.PUB_SUB_EVENTS) {
          try { window.publish(window.PUB_SUB_EVENTS.cartUpdate, { source: 'lp-cart', productVariantId: v.id, cartData: r.data }); } catch (e) { /* ignore */ }
        }
        if (cart && cart.renderContents && r.data.sections) {
          if (cart.classList.contains('is-empty')) cart.classList.remove('is-empty');
          cart.renderContents(r.data);
          status(form, 'Added to cart.', 'success');
        } else {
          status(form, 'Added to cart.', 'success');
          refreshCartBubble();
        }
      })
      .catch(function (err) {
        var msg = err && err.name === 'AbortError' ? 'The request timed out. Please try again.' : 'Network error. Please check your connection and try again.';
        status(form, msg, 'error');
      })
      .finally(function () {
        clearTimeout(timer);
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
        renderAll();
      });
  }
  function refreshCartBubble() {
    var bubble = document.getElementById('cart-icon-bubble');
    if (!bubble) return;
    fetch(root + '?sections=cart-icon-bubble')
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s['cart-icon-bubble']) return;
        var doc = new DOMParser().parseFromString(s['cart-icon-bubble'], 'text/html');
        var inner = doc.querySelector('.shopify-section');
        if (inner) bubble.innerHTML = inner.innerHTML;
      })
      .catch(function () { /* non-critical */ });
  }

  // ---------- binding ----------
  var forms = [];
  function renderAll() { forms.forEach(renderForm); }

  function bindForm(form) {
    forms.push(form);
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-lp-option]')) {
        var v = findVariant(currentOptions(form));
        setState({ variant: v }, form);
        syncUrl();
        status(form, '', '');
      } else if (t.matches('[data-lp-qty]')) {
        setState({ quantity: t.value }, form);
      }
    });
    form.addEventListener('click', function (e) {
      var step = e.target.closest('[data-lp-qty-step]');
      if (step) {
        e.preventDefault();
        setState({ quantity: store.quantity + parseInt(step.dataset.lpQtyStep, 10) }, form);
        return;
      }
      var scroll = e.target.closest('[data-lp-scroll-buy]');
      if (scroll) {
        e.preventDefault();
        var target = document.querySelector('[data-lp-form][data-lp-primary]');
        if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); var f = target.querySelector('input,select,button'); if (f) f.focus({ preventScroll: true }); }
      }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('[data-lp-atc]');
      if (btn) addToCart(form, btn);
    });
  }

  function bindSticky() {
    var bar = document.querySelector('[data-lp-sticky]');
    var primaries = document.querySelectorAll('[data-lp-form][data-lp-primary] [data-lp-atc]');
    if (!bar || !primaries.length || !('IntersectionObserver' in window)) return;
    var visible = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible.set(en.target, { on: en.isIntersecting, above: en.boundingClientRect.top < 0 }); });
      var anyOn = false, passed = false;
      visible.forEach(function (s) { if (s.on) anyOn = true; if (s.above) passed = true; });
      var show = !anyOn && passed;
      bar.classList.toggle('is-visible', show);
      bar.setAttribute('aria-hidden', show ? 'false' : 'true');
      Array.prototype.forEach.call(bar.querySelectorAll('button,a,input,select'), function (el) { el.tabIndex = show ? 0 : -1; });
    });
    Array.prototype.forEach.call(primaries, function (p) { io.observe(p); });
  }

  // Delegated handler for scroll-to-buy links outside forms (e.g. benefit CTAs)
  document.addEventListener('click', function (e) {
    var scroll = e.target.closest('[data-lp-scroll-buy]');
    if (!scroll || scroll.closest('[data-lp-form]')) return;
    e.preventDefault();
    var target = document.querySelector('[data-lp-form][data-lp-primary]') || document.querySelector('[data-lp-form]');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function init() {
    var dataEl = document.querySelector('script[data-lp-product]');
    if (!dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
    store.product = data.product;
    store.moneyFormat = data.moneyFormat || store.moneyFormat;
    var initial = null;
    for (var i = 0; i < store.product.variants.length; i++) if (store.product.variants[i].id === data.selectedVariantId) initial = store.product.variants[i];
    store.variant = initial || store.product.variants[0] || null;
    Array.prototype.forEach.call(document.querySelectorAll('[data-lp-form]'), bindForm);
    subscribe(function () { renderAll(); });
    renderAll();
    bindSticky();
  }

  window.LPCart = { store: store, formatMoney: formatMoney, findVariant: findVariant, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
