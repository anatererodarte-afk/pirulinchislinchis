import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { eq } from 'drizzle-orm';
import { database } from '../../db/index.js';
import { content, progress } from '../../db/schema.js';
import type { Config } from '@netlify/functions';

function json(value: unknown, status = 200, extra = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...extra } });
}
function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function signature(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function authenticated(req: Request, secret: string) {
  if (!secret) return false;
  const cookie = req.headers.get('cookie')?.match(/(?:^|;\s*)piru_admin=([^;]+)/)?.[1] || '';
  const [expiry, sig] = cookie.split('.');
  return !!sig && Number(expiry) > Date.now() && same(sig, signature(expiry, secret));
}
function validSlot(slot: string) { return /^(?:[0-7]|39)$/.test(slot); }
async function read(id: string) {
  const rows = await database().select().from(content).where(eq(content.id, id));
  return rows[0]?.value;
}
async function write(id: string, value: unknown) {
  await database().insert(content).values({ id, value }).onConflictDoUpdate({ target: content.id, set: { value, updatedAt: new Date() } });
}
async function bytes(req: Request, max = 4 * 1024 * 1024) {
  const data = await req.arrayBuffer();
  if (!data.byteLength || data.byteLength > max) throw new Error('size');
  return data;
}
export default async function handler(req: Request) {
  const path = new URL(req.url).pathname;
  const secret = Netlify.env.get('PIRULINCHIS_ADMIN_PASSWORD') || '';
  const admin = authenticated(req, secret);
  const method = req.method;
  if (path === '/api/pirulinchis-content/auth') {
    if (method === 'GET') return json({ authenticated: admin }, admin ? 200 : 401);
    if (method === 'DELETE') return json({ ok: true }, 200, { 'Set-Cookie': 'piru_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
    if (method !== 'POST') return json({ error: 'Método no permitido' }, 405);
    if (!secret) return json({ error: 'Falta configurar la contraseña de administración.' }, 503);
    if (!same(req.headers.get('x-edit-password') || '', secret)) return json({ error: 'Contraseña incorrecta.' }, 401);
    const expiry = String(Date.now() + 8 * 3600000);
    return json({ ok: true }, 200, { 'Set-Cookie': `piru_admin=${expiry}.${signature(expiry, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
  }
  // Every read of player progress or evidence requires a verified server session.
  const privateRead = (path === '/api/progress' || path.startsWith('/api/proofs')) && method === 'GET';
  const contentWrite = path.startsWith('/api/pirulinchis-content/') && method !== 'GET';
  if ((privateRead || contentWrite) && !admin) return json({ error: 'Acceso exclusivo de administración.' }, 401);
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(method)) return json({ error: 'Método no permitido' }, 405);
  try {
    if (path === '/api/progress') {
      if (method === 'GET') {
        const rows = await database().select().from(progress);
        return json(rows.map(r => ({ ...(r.value as object), id: r.id, first: r.first, ts: r.updatedAt })));
      }
      if (method !== 'POST') return json({}, 405);
      const p = await req.json();
      if (!/^[a-z0-9-]{16,100}$/.test(p.id || '') || JSON.stringify(p).length > 12000) return json({}, 400);
      const number = (v: unknown, max = 10000) => Math.min(max, Math.max(0, Number(v) || 0));
      const stats = (v: any) => ({ ok: number(v?.ok), n: number(v?.n), tot: number(v?.tot) });
      const value = { name: String(p.name || '').slice(0,40), pts: number(p.pts), dp: number(p.dp,80), photos: number(p.photos,8), games: Array.isArray(p.games) ? p.games.slice(0,8).map((g: unknown) => String(g).slice(0,40)) : [], tri: stats(p.tri), geo: stats(p.geo), tgpts: number(p.tgpts,80) };
      await database().insert(progress).values({ id: p.id, value }).onConflictDoUpdate({ target: progress.id, set: { value, updatedAt: new Date() } });
      return json({ ok: true });
    }
    if (path === '/api/photos') return json([]);
    if (path === '/api/pirulinchis-content/photos') {
      if (method !== 'GET') return json({},405);
      const rows = await database().select().from(content);
      return json(rows.filter(r => /^photo:\d+$/.test(r.id)).map(r => r.value));
    }
    const photo = path.match(/^\/api\/pirulinchis-content\/photos\/(\d+)$/);
    const media = path.match(/^\/api\/pirulinchis-content\/letter-media\/([a-zA-Z0-9-]{1,100})$/);
    if (photo || media) {
      if (photo && !validSlot(photo[1])) return json({},400);
      const id = photo ? `photo:${photo[1]}` : `media:${media![1]}`;
      if (method === 'GET') {
        const record = await read(id) as any;
        if (!record || record.deleted) return json({},404);
        const data = await getStore('birthday-files').get(record.key, { type: 'stream' });
        return data ? new Response(data, { headers: { 'Content-Type': record.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }) : json({},404);
      }
      if (method === 'DELETE' && photo) { await write(id,{ slot: Number(photo[1]), deleted: true }); return json({ ok:true }); }
      if (method !== 'PUT') return json({},405);
      const type = req.headers.get('content-type') || '';
      if (!(photo ? /^image\/(jpeg|png|webp|gif)$/ : /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/).test(type)) return json({ error: 'Formato no admitido.' },400);
      const data = await bytes(req), key = randomUUID(), v = Date.now();
      await getStore('birthday-files').set(key, data);
      await write(id, { key, type, v, ...(photo ? { slot: Number(photo[1]) } : {}) });
      return json({ ok:true, url:path });
    }
    if (path === '/api/pirulinchis-content/letters') {
      if (method === 'GET') return json((await read('letters')) || null);
      if (method !== 'PUT') return json({},405);
      const letters = await req.json();
      if (!Array.isArray(letters) || letters.length > 20) return json({},400);
      const value = letters.map(l => ({ title: String(l.title || '').slice(0,100), text: String(l.text || '').slice(0,4000), src: String(l.src || '').slice(0,700), kind: l.kind === 'image' ? 'image' : 'video' }));
      await write('letters', value); return json({ ok:true });
    }
    // Evidence uploads are public; their list and video streams are private.
    if (path === '/api/proofs' && method === 'GET') {
      const rows = await database().select().from(content);
      return json(rows.filter(r => r.id.startsWith('proof:')).map(r => r.value));
    }
    const proof = path.match(/^\/api\/proofs\/([a-z0-9-]{16,100})(?:\/(done|\d+))?$/);
    if (proof) {
      const [,id,part] = proof, store = getStore({ name:'birthday-evidence', consistency:'strong' });
      if (method === 'PUT' && part && /^\d+$/.test(part) && Number(part)<40) {
        await store.set(`${id}/${part}`, await bytes(req,3*1024*1024)); return json({ ok:true });
      }
      if (method === 'POST' && part === 'done') {
        const p = await req.json();
        if (!Number.isInteger(p.parts) || p.parts<1 || p.parts>40 || !/^video\/(webm|mp4)(;.*)?$/.test(p.ct)) return json({},400);
        for(let i=0;i<p.parts;i++) if (!await store.getMetadata(`${id}/${i}`)) return json({},400);
        await write(`proof:${id}`, { id, parts:p.parts, ct:p.ct, g:String(p.g||'').slice(0,60), who:String(p.who||'').slice(0,40), ts:new Date().toISOString() });
        return json({ ok:true });
      }
      if (method === 'GET' && !part) {
        const p = await read(`proof:${id}`) as any;
        if (!p) return json({},404);
        const stream = new ReadableStream({ async start(controller) {
          try { for(let i=0;i<p.parts;i++) { const data = await store.get(`${id}/${i}`,{ type:'arrayBuffer' }); if(!data) throw new Error('missing'); controller.enqueue(new Uint8Array(data)); } controller.close(); } catch { controller.error(new Error('Video no disponible')); }
        } });
        return new Response(stream,{ headers:{ 'Content-Type':p.ct, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
      }
    }
    return json({ error:'No encontrado' },404);
  } catch (e) { return json({ error: e instanceof Error && e.message === 'size' ? 'Archivo demasiado grande.' : 'No se pudo completar la operación.' }, e instanceof Error && e.message === 'size' ? 413 : 500); }
}
export const config: Config = { path: ['/api/pirulinchis-content/*', '/api/progress', '/api/photos', '/api/proofs', '/api/proofs/*'] };
