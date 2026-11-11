import { describe, expect, it } from 'vitest';
import { safeCourseUrl } from './courses';
import { resolveBlogPost, resolveBlogPosts } from './blog';
import { seedBlogPosts } from '@/data/blogPosts';

describe('course destination URLs', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', '//example.com', 'https://user:pass@example.com', 'https://example.com/a b', 'https://example.com\\@evil.com'])('blocks %s', (url) => expect(safeCourseUrl(url, 'external')).toBeNull());
  it('allows external HTTPS', () => expect(safeCourseUrl('https://example.com/course', 'external')).toBe('https://example.com/course'));
  it.each(['http://wa.me/123', 'https://wa.me:444/123', 'https://wa.me.evil.com/123', 'https://example.com'])('blocks invalid WhatsApp destination %s', (url) => expect(safeCourseUrl(url, 'whatsapp')).toBeNull());
  it('allows official WhatsApp HTTPS', () => expect(safeCourseUrl('https://wa.me/5511999999999', 'whatsapp')).toBe('https://wa.me/5511999999999'));
});
it('preserves all four guide texts but hides resin by default', () => {
  const all = resolveBlogPosts(seedBlogPosts, {}, {});
  expect(all).toHaveLength(4);
  expect(all.filter((p) => p.active)).toHaveLength(3);
  expect(all.find((p) => p.slug === 'quando-usar-resina-impressao-3d')!.content).toBe(seedBlogPosts[3].content);
});
it('honors false/true admin visibility without losing saved content or cover', () => {
  const inactive = resolveBlogPost(seedBlogPosts[0], { active: false, title: 'Título salvo' }, '/uploads/site/cover.png');
  expect(inactive).toMatchObject({ active: false, title: 'Título salvo', cover: '/uploads/site/cover.png', customized: true });
  expect(resolveBlogPost(seedBlogPosts[3], { active: true }).active).toBe(true);
});
