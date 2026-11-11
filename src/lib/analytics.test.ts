// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); localStorage.clear(); document.head.innerHTML = ''; delete window.gtag; vi.stubEnv('VITE_GA_MEASUREMENT_ID', 'G-TEST'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('does not emit course clicks without analytics consent', async () => {
  const { trackCourseClick, loadAnalytics } = await import('./analytics');
  window.gtag = vi.fn(); loadAnalytics(); trackCourseClick('course1', 'whatsapp');
  expect(window.gtag).not.toHaveBeenCalled(); expect(document.querySelector('script')).toBeNull();
});
it('emits only course id/type after consent and stops if consent is revoked', async () => {
  localStorage.setItem('cookie-consent', JSON.stringify({ analytics: true, date: '2026-11-11' }));
  const { trackCourseClick, loadAnalytics } = await import('./analytics');
  loadAnalytics(); const spy = vi.fn(); window.gtag = spy;
  trackCourseClick('course1', 'whatsapp');
  expect(spy).toHaveBeenCalledWith('event', 'course_cta_click', { course_id: 'course1', cta_type: 'whatsapp' });
  spy.mockClear(); localStorage.setItem('cookie-consent', JSON.stringify({ analytics: false, date: '2026-11-11' }));
  trackCourseClick('course1', 'external'); expect(spy).not.toHaveBeenCalled();
});
