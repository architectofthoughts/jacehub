import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDateOf, questMatches, computeStreak } from '../lib/quest-logic.js';

test('kstDateOf: UTC 15:00은 다음날 서울 0시이므로 +1일', () => {
  // 2026-05-31T15:00:00Z === 2026-06-01 00:00 KST
  assert.equal(kstDateOf('2026-05-31T15:00:00Z'), '2026-06-01');
});

test('kstDateOf: UTC 14:59는 같은날 서울 23:59', () => {
  assert.equal(kstDateOf('2026-05-31T14:59:00Z'), '2026-05-31');
});

test('questMatches: event_type 없는 퀘스트는 같은 앱 아무 이벤트나 매칭', () => {
  const q = { app_name: 'rituall', event_type: null };
  assert.equal(questMatches(q, 'rituall', 'morning_ritual'), true);
  assert.equal(questMatches(q, 'rituall', null), true);
  assert.equal(questMatches(q, 'transparenty', 'x'), false);
});

test('questMatches: event_type 지정 퀘스트는 타입까지 같아야 매칭', () => {
  const q = { app_name: 'rituall', event_type: 'evening_ritual' };
  assert.equal(questMatches(q, 'rituall', 'evening_ritual'), true);
  assert.equal(questMatches(q, 'rituall', 'morning_ritual'), false);
});

test('computeStreak: 오늘부터 연속 클리어 일수', () => {
  const dates = ['2026-05-31', '2026-05-30', '2026-05-29', '2026-05-27'];
  assert.equal(computeStreak(dates, '2026-05-31'), 3);
});

test('computeStreak: 오늘 미클리어여도 어제까지 이어지면 어제 기준 연속 인정', () => {
  const dates = ['2026-05-30', '2026-05-29'];
  assert.equal(computeStreak(dates, '2026-05-31'), 2);
});

test('computeStreak: 어제도 오늘도 없으면 0', () => {
  assert.equal(computeStreak(['2026-05-28'], '2026-05-31'), 0);
});
