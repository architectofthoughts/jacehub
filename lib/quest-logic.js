// 순수 로직 — Cloudflare 런타임 API 비의존. node:test로 검증 가능.

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** ISO 문자열/ms를 Asia/Seoul 기준 'YYYY-MM-DD'로 변환 */
export function kstDateOf(input) {
  const ms = typeof input === 'number' ? input : Date.parse(input);
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 퀘스트가 (앱, 이벤트타입) 이벤트와 매칭되는지.
 *  event_type이 falsy면 같은 앱의 모든 이벤트와 매칭(앱 단위). */
export function questMatches(quest, app, eventType) {
  if (quest.app_name !== app) return false;
  if (!quest.event_type) return true;
  return quest.event_type === eventType;
}

/** completed=1인 날짜 배열(순서 무관)에서, today 또는 어제부터 이어지는 연속 일수.
 *  오늘이 비어 있어도 어제까지 이어지면 그 길이를 인정(아직 오늘 안 한 것일 뿐). */
export function computeStreak(completedDates, today) {
  const set = new Set(completedDates);
  const dayMs = 24 * 3600 * 1000;
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  // 시작점: 오늘이 있으면 오늘, 없고 어제가 있으면 어제, 둘 다 없으면 0
  let cursor;
  if (set.has(today)) {
    cursor = todayMs;
  } else if (set.has(new Date(todayMs - dayMs).toISOString().slice(0, 10))) {
    cursor = todayMs - dayMs;
  } else {
    return 0;
  }

  let streak = 0;
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= dayMs;
  }
  return streak;
}
