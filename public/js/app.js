(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * Modals (used for "Lihat" detail views and inline edit forms)
   * ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    const opener = e.target.closest('[data-modal-open]');
    if (opener) {
      const id = opener.getAttribute('data-modal-open');
      const modal = document.getElementById(id);
      if (modal) {
        modal.classList.add('open');
        const firstInput = modal.querySelector('input, textarea, select');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
      }
    }
    const closer = e.target.closest('[data-modal-close]');
    if (closer) {
      const modal = closer.closest('.modal-overlay');
      if (modal) modal.classList.remove('open');
    }
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('open');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
    }
  });

  /* ------------------------------------------------------------------
   * Sidebar "LMS" collapsible nav group — remembers open/closed state
   * ------------------------------------------------------------------ */
  document.querySelectorAll('[data-lms-toggle]').forEach((btn) => {
    btn.addEventListener('click', function () {
      const group = btn.closest('.nav-group');
      if (!group) return;
      const willOpen = !group.classList.contains('open');
      group.classList.toggle('open', willOpen);
      try { localStorage.setItem('spk-lms-nav-open', willOpen ? '1' : '0'); } catch (err) { /* ignore */ }
    });
  });

  /* ------------------------------------------------------------------
   * Password show/hide toggle (login + profile forms)
   * ------------------------------------------------------------------ */
  document.querySelectorAll('.password-toggle').forEach((btn) => {
    btn.addEventListener('click', function () {
      const wrap = btn.closest('.password-field-wrap');
      const input = wrap && wrap.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Tampilkan password' : 'Sembunyikan password');
      btn.classList.toggle('is-showing', !showing);
    });
  });

  /* ------------------------------------------------------------------
   * Animated stat counters — any element with [data-count="123"]
   * ------------------------------------------------------------------ */
  function animateCount(el) {
    const target = Number(el.getAttribute('data-count')) || 0;
    const duration = 800;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toString();
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = target.toString();
    }
    requestAnimationFrame(tick);
  }
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.4 });
      counters.forEach((el) => io.observe(el));
    } else {
      counters.forEach(animateCount);
    }
  }

  /* ------------------------------------------------------------------
   * Reveal-on-scroll for elements marked .reveal (used on landing page)
   * ------------------------------------------------------------------ */
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const revealIo = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          revealIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach((el) => revealIo.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in-view'));
  }

  /* ------------------------------------------------------------------
   * Public landing page: navbar solid-on-scroll, mobile nav toggle,
   * scrollspy (highlight the nav link for the section in view)
   * ------------------------------------------------------------------ */
  const publicNavbar = document.querySelector('.public-navbar');
  if (publicNavbar) {
    const onScroll = () => {
      publicNavbar.classList.toggle('solid', window.scrollY > 40);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.public-nav-links');
    if (navToggle && navLinks) {
      navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
      navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => navLinks.classList.remove('open')));
    }

    const sections = Array.from(document.querySelectorAll('.public-section, .hero')).filter((s) => s.id);
    const spyLinks = Array.from(document.querySelectorAll('.public-nav-links a[href^="#"]'));
    if (sections.length && spyLinks.length && 'IntersectionObserver' in window) {
      const spyIo = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            spyLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
      sections.forEach((s) => spyIo.observe(s));
    }
  }

  /* ------------------------------------------------------------------
   * Contact form on the landing page: client-side only (no email
   * backend is configured in this project), shows a confirmation note.
   * ------------------------------------------------------------------ */
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const status = document.getElementById('contactFormStatus');
      if (status) {
        status.classList.add('show');
        status.textContent = 'Terima kasih, pesan Anda telah dicatat secara lokal. Untuk tanggapan resmi, silakan hubungi kontak di atas secara langsung.';
      }
      contactForm.reset();
    });
  }
})();
