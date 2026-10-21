/* Alneya — progressive enhancement only. Every page works with JS disabled. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ------------------------------------------------------------- mobile nav */

  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    var setNav = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('nav-open', open);
    };

    toggle.addEventListener('click', function () {
      setNav(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setNav(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setNav(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (event) {
      if (
        toggle.getAttribute('aria-expanded') === 'true' &&
        !event.target.closest('#site-nav') &&
        !event.target.closest('[data-nav-toggle]')
      ) setNav(false);
    });
  }

  /* --------------------------------------------------- header shadow on scroll */

  var header = document.querySelector('[data-header]');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-stuck', window.scrollY > 24); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* -------------------------------------------------------- library filters */

  var grid = document.querySelector('[data-library]');
  if (grid) {
    var filters = Array.prototype.slice.call(document.querySelectorAll('.filter'));
    var entries = Array.prototype.slice.call(grid.querySelectorAll('.entry'));
    var empty = document.querySelector('[data-library-empty]');

    filters.forEach(function (button) {
      button.addEventListener('click', function () {
        var wanted = button.dataset.filter;
        filters.forEach(function (other) { other.classList.toggle('is-active', other === button); });

        var shown = 0;
        entries.forEach(function (entry) {
          var match = wanted === 'all' || entry.dataset.category === wanted;
          entry.hidden = !match;
          if (match) shown++;
        });
        if (empty) empty.hidden = shown > 0;
      });
    });
  }

  /* ------------------------------------------------------- cover-story carousel */

  var press = document.querySelector('[data-press]');
  if (press) {
    var slides = Array.prototype.slice.call(press.querySelectorAll('[data-press-slide]'));
    var counters = Array.prototype.slice.call(press.querySelectorAll('[data-press-count]'));
    var index = Math.max(0, slides.findIndex(function (s) { return s.classList.contains('is-current'); }));

    var show = function (next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var current = i === index;
        slide.classList.toggle('is-current', current);
        // keep the hidden slides out of the tab order and the accessibility tree
        slide.querySelectorAll('a').forEach(function (a) { a.tabIndex = current ? 0 : -1; });
      });
      // each slide carries its own controls, so update them all
      counters.forEach(function (c) { c.textContent = index + 1 + ' / ' + slides.length; });
    };

    press.addEventListener('click', function (event) {
      if (event.target.closest('[data-press-prev]')) show(index - 1);
      else if (event.target.closest('[data-press-next]')) show(index + 1);
    });
    show(index);
  }

  /* -------------------------------------------------------------- reveal-in */

  if (
    'IntersectionObserver' in window &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    var targets = Array.prototype.slice.call(document.querySelectorAll('.section > .wrap, .hero__copy'));

    var reveal = function (node) { node.classList.add('is-visible'); };

    var observer = new IntersectionObserver(function (items) {
      items.forEach(function (item) {
        if (!item.isIntersecting) return;
        reveal(item.target);
        observer.unobserve(item.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.02 });

    targets.forEach(function (node) {
      node.classList.add('reveal');
      observer.observe(node);
    });

    // Failsafe: never leave content hidden because an observer didn't fire.
    window.setTimeout(function () { targets.forEach(reveal); }, 2500);
  }

  /* ------------------------------------------------------------------ forms
   * The markup posts normally. Until a real endpoint is wired up, intercept
   * the submit so nobody thinks their message went somewhere.
   */

  Array.prototype.forEach.call(document.querySelectorAll('form[data-form]'), function (form) {
    var action = form.getAttribute('action') || '';
    if (action.indexOf('#TODO') !== 0) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var status = form.querySelector('.form__status');
      if (!status) {
        status = document.createElement('p');
        status.className = 'form__status';
        form.appendChild(status);
      }
      status.dataset.state = 'error';
      status.textContent =
        'This form is not connected yet — set the form action in src/locales/*.json before launch.';
    });
  });
})();
