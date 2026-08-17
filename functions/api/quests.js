// Cloudflare Pages Function — 퀘스트 CRUD
// Route: /api/quests
import { CORS_HEADERS, json, bad, uuid, nowIso, validatePin, requireDb } from './_quest_shared.js';

function serializeQuest(row) {
  return {
    id: row.id,
    app_name: row.app_name,
    title: row.title,
    event_type: row.event_type || null,
    target_count: row.target_count,
    active: !!row.active,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const method = request.method;

  // ── GET: 목록 ──
  if (method === 'GET') {
    const pin = url.searchParams.get('pin');
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    const { results } = await env.DB.prepare(
      'SELECT * FROM quests WHERE pin = ? AND active = 1 ORDER BY app_name, sort_order, created_at'
    ).bind(pin).all();
    return json({ ok: true, quests: (results || []).map(serializeQuest) });
  }

  // ── POST: 생성 ──
  if (method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return bad('invalid JSON'); }
    const { pin, app_name, title } = body;
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!app_name || !title) return bad('app_name과 title은 필수입니다');

    const event_type = body.event_type ? String(body.event_type).trim().slice(0, 60) : null;
    const target_count = Math.max(1, parseInt(body.target_count, 10) || 1);
    const id = uuid();
    await env.DB.prepare(
      `INSERT INTO quests (id, pin, app_name, title, event_type, target_count, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`
    ).bind(id, pin, String(app_name).trim(), String(title).trim().slice(0, 120), event_type, target_count, nowIso()).run();

    const row = await env.DB.prepare('SELECT * FROM quests WHERE id = ?').bind(id).first();
    return json({ ok: true, quest: serializeQuest(row) }, { status: 201 });
  }

  // ── PUT: 수정 (title / target_count / active / sort_order) ──
  if (method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return bad('invalid JSON'); }
    const { pin, id } = body;
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!id) return bad('id는 필수입니다');

    const existing = await env.DB.prepare('SELECT * FROM quests WHERE id = ? AND pin = ?').bind(id, pin).first();
    if (!existing) return bad('해당 퀘스트를 찾을 수 없습니다', 404);

    const title = body.title != null ? String(body.title).trim().slice(0, 120) : existing.title;
    const target_count = body.target_count != null ? Math.max(1, parseInt(body.target_count, 10) || 1) : existing.target_count;
    const active = body.active != null ? (body.active ? 1 : 0) : existing.active;
    const sort_order = body.sort_order != null ? (parseInt(body.sort_order, 10) || 0) : existing.sort_order;

    await env.DB.prepare(
      'UPDATE quests SET title = ?, target_count = ?, active = ?, sort_order = ? WHERE id = ?'
    ).bind(title, target_count, active, sort_order, id).run();

    const row = await env.DB.prepare('SELECT * FROM quests WHERE id = ?').bind(id).first();
    return json({ ok: true, quest: serializeQuest(row) });
  }

  // ── DELETE: 삭제 (연관 daily_progress 정리) ──
  if (method === 'DELETE') {
    const pin = url.searchParams.get('pin');
    const id = url.searchParams.get('id');
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!id) return bad('id는 필수입니다');

    const existing = await env.DB.prepare('SELECT id FROM quests WHERE id = ? AND pin = ?').bind(id, pin).first();
    if (!existing) return bad('해당 퀘스트를 찾을 수 없습니다', 404);

    await env.DB.prepare('DELETE FROM daily_progress WHERE quest_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM quests WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
}
