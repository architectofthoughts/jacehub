// Cloudflare Pages Function — 현황·통계
// Route: /api/progress
import { CORS_HEADERS, json, bad, validatePin, requireDb } from './_quest_shared.js';
import { kstDateOf, computeStreak } from '../../lib/quest-logic.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  }

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const pin = url.searchParams.get('pin');
  if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  // 내 active 퀘스트
  const { results: quests } = await env.DB.prepare(
    'SELECT * FROM quests WHERE pin = ? AND active = 1 ORDER BY app_name, sort_order, created_at'
  ).bind(pin).all();
  const questIds = (quests || []).map((q) => q.id);

  // ── 기간 모드: 잔디·통계용 일별 매트릭스 ──
  if (from && to) {
    if (questIds.length === 0) return json({ ok: true, quests: [], days: [] });
    const placeholders = questIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT quest_id, date, count, completed FROM daily_progress
        WHERE quest_id IN (${placeholders}) AND date >= ? AND date <= ?
        ORDER BY date`
    ).bind(...questIds, from, to).all();
    return json({
      ok: true,
      quests: (quests || []).map((q) => ({ id: q.id, app_name: q.app_name, title: q.title, target_count: q.target_count, event_type: q.event_type || null })),
      days: results || [],
    });
  }

  // ── 단일 날짜 모드: 오늘 현황 + 스트릭 ──
  const date = url.searchParams.get('date') || kstDateOf(new Date().toISOString());
  const out = [];
  for (const q of quests || []) {
    const todayRow = await env.DB.prepare(
      'SELECT count, completed FROM daily_progress WHERE quest_id = ? AND date = ?'
    ).bind(q.id, date).first();

    // 스트릭: 이 퀘스트의 completed=1 날짜 전부
    const { results: doneRows } = await env.DB.prepare(
      'SELECT date FROM daily_progress WHERE quest_id = ? AND completed = 1'
    ).bind(q.id).all();
    const streak = computeStreak((doneRows || []).map((r) => r.date), date);

    out.push({
      id: q.id,
      app_name: q.app_name,
      title: q.title,
      event_type: q.event_type || null,
      target_count: q.target_count,
      count: todayRow ? todayRow.count : 0,
      completed: todayRow ? !!todayRow.completed : false,
      streak,
    });
  }

  return json({ ok: true, date, quests: out });
}
