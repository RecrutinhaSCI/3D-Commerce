/** Migration aditiva em schema isolado: só habilita em TEST_DATABASE_URL local *_test. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { dbEnabled, TEST_URL } from '../shipping/labels/labels.dbHarness.testdata';

it.skipIf(!dbEnabled)('migration preserva guias existentes, oculta resina e cria cursos sem preço; tolera JSON/SQL null', async () => {
  const schema = `courses_migration_test_${process.pid}`;
  const url = new URL(TEST_URL!); url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasourceUrl: url.toString() });
  // Nome derivado apenas de PID numérico; nunca inclui entrada do usuário.
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    const sql = readFileSync(path.resolve('prisma/migrations/202611110002_courses/migration.sql'), 'utf8');
    expect(sql.trim().startsWith('BEGIN;')).toBe(true); expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    const statements = sql.replace(/^--.*$/gm, '').split(';').map((part) => part.trim()).filter((part) => part && part !== 'BEGIN' && part !== 'COMMIT');
    const visibilityUpdate = statements.find((part) => part.startsWith('UPDATE "site_settings"'))!;
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TABLE site_settings (id TEXT PRIMARY KEY, blog_content_json JSONB, blog_covers_json JSONB)');
      const original = { 'quando-usar-resina-impressao-3d': { title: 'Título preservado', content: 'Texto salvo', active: true }, outro: { title: 'Outro guia', active: true } };
      const covers = { 'quando-usar-resina-impressao-3d': 'https://test.example/capa.png' };
      await tx.$executeRaw`INSERT INTO site_settings (id, blog_content_json, blog_covers_json) VALUES ('main', ${JSON.stringify(original)}::jsonb, ${JSON.stringify(covers)}::jsonb)`;
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      const read = async () => (await tx.$queryRaw<Array<{ blog_content_json: Record<string, unknown>; blog_covers_json: unknown }>>`SELECT blog_content_json, blog_covers_json FROM site_settings WHERE id='main'`)[0];
      expect(await read()).toEqual({ blog_content_json: { ...original, 'quando-usar-resina-impressao-3d': { ...original['quando-usar-resina-impressao-3d'], active: false } }, blog_covers_json: covers });
      const course = await tx.course.create({ data: { title: 'Mentoria', slug: 'mentoria', externalUrl: 'https://wa.me/5554999990000', ctaType: 'whatsapp' } });
      expect(course.price).toBeNull(); expect(course.active).toBe(false);
      expect((await tx.course.update({ where: { id: course.id }, data: { price: new Prisma.Decimal('99.90'), active: true } })).price?.toNumber()).toBe(99.9);
      await tx.course.delete({ where: { id: course.id } });
      expect(await tx.course.count()).toBe(0);
      for (const value of ['null', '{}']) {
        await tx.$executeRaw`UPDATE site_settings SET blog_content_json=${value}::jsonb WHERE id='main'`;
        await tx.$executeRawUnsafe(visibilityUpdate);
        expect((await read()).blog_content_json).toEqual({ 'quando-usar-resina-impressao-3d': { active: false } });
      }
      await tx.$executeRaw`UPDATE site_settings SET blog_content_json=NULL WHERE id='main'`;
      await tx.$executeRawUnsafe(visibilityUpdate);
      expect((await read()).blog_content_json).toEqual({ 'quando-usar-resina-impressao-3d': { active: false } });
    }, { timeout: 30000 });
  } finally {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  }
}, 40000);
