// Cloudflare Pages Function — 이벤트 수집구
// Route: /api/ingest
import { CORS_HEADERS, json, bad, uuid, nowIso, validatePin, requireDb } from './_quest_shared.js';
import { kstDateOf, questMatches } from '../../lib/quest-logic.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  }

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const { pin, app } = body;
  if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
  if (!app) return bad('app은 필수입니다');

  const eventType = body.event_type ? String(body.event_type).trim().slice(0, 60) : null;
  const count = Math.max(1, parseInt(body.count, 10) || 1);
  const occurredAt = nowIso();
  const date = kstDateOf(occurredAt);

  // 1) 원시 로그 적재
  await env.DB.prepare(
    'INSERT INTO quest_events (id, pin, app_name, event_type, occurred_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(uuid(), pin, String(app).trim(), eventType, occurredAt).run();

  // 2) 매칭 퀘스트 집계
  const { results } = await env.DB.prepare(
    'SELECT * FROM quests WHERE pin = ? AND app_name = ? AND active = 1'
  ).bind(pin, String(app).trim()).all();

  let matched = 0;
  for (const quest of results || []) {
    if (!questMatches(quest, String(app).trim(), eventType)) continue;
    matched += 1;

    // 오늘자 진행 upsert (+count)
    await env.DB.prepare(
      `INSERT INTO daily_progress (quest_id, date, count, completed, completed_at)
       VALUES (?, ?, ?, 0, NULL)
       ON CONFLICT(quest_id, date) DO UPDATE SET count = count + excluded.count`
    ).bind(quest.id, date, count).run();

    // target 도달 & 미완료면 completed 마킹
    await env.DB.prepare(
      `UPDATE daily_progress
         SET completed = 1, completed_at = ?
       WHERE quest_id = ? AND date = ? AND completed = 0 AND count >= ?`
    ).bind(occurredAt, quest.id, date, quest.target_count).run();
  }

  return json({ ok: true, matched });
}
