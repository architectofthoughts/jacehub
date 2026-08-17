// 퀘스트 페이지 로직 — PIN으로 /api/quests·/api/progress 호출.
const PIN = localStorage.getItem('jacehub_vault_pin') || '';
const FAVORITES = JSON.parse(localStorage.getItem('jacehub_favorites') || '[]');

const $ = (sel) => document.querySelector(sel);

// 앱별 "행동(이벤트 타입)" 카탈로그.
// 앞으로 다른 앱 연동 시 여기에 항목을 추가하면 행동 드롭다운이 자동으로 채워진다.
const EVENT_CATALOG = {
  rituall: [
    { value: 'morning_ritual', label: '아침 의식 완료' },
    { value: 'evening_ritual', label: '저녁 의식 완료' },
  ],
  // 앞으로 다른 앱 연동 시 여기에 추가
};

// 특수 옵션 식별자 (실제 event_type 값과 충돌하지 않도록 prefix 사용)
const APP_LEVEL = '__app_level__';   // 앱 단위 — event_type 미전송
const CUSTOM = '__custom__';         // 직접 입력

// 목표 횟수 옵션 (1은 의미를 곁들여 표시)
const TARGET_OPTIONS = [
  { value: 1, label: '1회 (단순 완료)' },
  { value: 2, label: '2회' },
  { value: 3, label: '3회' },
  { value: 5, label: '5회' },
  { value: 7, label: '7회' },
  { value: 10, label: '10회' },
];

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysAgo(n) {
  return new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

// ── 새 퀘스트 폼 ──────────────────────────────────────────────

// 행동 라벨 조회 (자동 제목 제안용)
function eventLabelFor(app, value) {
  const list = EVENT_CATALOG[app] || [];
  const hit = list.find((e) => e.value === value);
  return hit ? hit.label : '';
}

// 앱 선택에 따라 행동 드롭다운을 다시 채운다 (의존형 셀렉트)
function refreshEventOptions() {
  const app = $('#f_app').value;
  const sel = $('#f_event');
  const actions = EVENT_CATALOG[app] || [];

  const opts = [`<option value="${APP_LEVEL}">앱 단위 — 아무 행동이나</option>`];
  for (const a of actions) {
    opts.push(`<option value="${a.value}">${a.label}</option>`);
  }
  opts.push(`<option value="${CUSTOM}">직접 입력…</option>`);
  sel.innerHTML = opts.join('');
  sel.value = APP_LEVEL;
  refreshCustomField();
}

// 행동 선택이 "직접 입력"일 때만 커스텀 입력칸을 보여준다
function refreshCustomField() {
  const isCustom = $('#f_event').value === CUSTOM;
  const field = $('#customEventField');
  field.classList.toggle('hidden', !isCustom);
  const input = $('#f_event_custom');
  input.required = isCustom;
  if (!isCustom) input.value = '';
  if (isCustom) input.focus();
}

// 행동을 고르면 제목이 비어 있을 때만 라벨을 자동 제안
function suggestTitle() {
  const titleEl = $('#f_title');
  if (titleEl.value.trim()) return;
  const label = eventLabelFor($('#f_app').value, $('#f_event').value);
  if (label) titleEl.value = label;
}

function initForm() {
  // 앱 드롭다운: 즐겨찾기 목록
  const appSel = $('#f_app');
  if (FAVORITES.length) {
    appSel.innerHTML = FAVORITES.map((a) => `<option value="${a}">${a}</option>`).join('');
    appSel.disabled = false;
  } else {
    appSel.innerHTML = '<option value="">즐겨찾기한 앱이 없어요 — 허브에서 추가하세요</option>';
    appSel.disabled = true;
  }

  // 목표 횟수 드롭다운
  $('#f_target').innerHTML = TARGET_OPTIONS
    .map((o) => `<option value="${o.value}">${o.label}</option>`)
    .join('');

  refreshEventOptions();

  appSel.addEventListener('change', refreshEventOptions);
  $('#f_event').addEventListener('change', () => {
    refreshCustomField();
    suggestTitle();
  });
}

async function loadAll() {
  if (!PIN || !/^\d{6}$/.test(PIN)) {
    $('#needPin').classList.remove('hidden');
    return;
  }

  const today = kstToday();
  const from = daysAgo(20); // 최근 3주(21일)
  const [progress, range] = await Promise.all([
    api(`/api/progress?pin=${PIN}`),
    api(`/api/progress?pin=${PIN}&from=${from}&to=${today}`),
  ]);

  const quests = progress.quests || [];
  const cleared = quests.filter((q) => q.completed).length;
  $('#summary').textContent = `${cleared}/${quests.length}`;

  // 잔디용: quest_id+date → completed
  const heat = {};
  for (const d of range.days || []) {
    heat[`${d.quest_id}|${d.date}`] = d.completed ? 1 : (d.count > 0 ? 0.5 : 0);
  }

  // 앱별 그룹
  const byApp = {};
  for (const q of quests) (byApp[q.app_name] ||= []).push(q);

  const groups = $('#groups');
  groups.innerHTML = '';
  for (const [app, list] of Object.entries(byApp)) {
    const g = document.createElement('div');
    g.className = 'q-group';
    g.innerHTML = `<h3>${app}</h3>`;
    for (const q of list) {
      const pct = Math.min(100, Math.round((q.count / q.target_count) * 100));
      const cells = [];
      for (let i = 20; i >= 0; i--) {
        const v = heat[`${q.id}|${daysAgo(i)}`] || 0;
        cells.push(`<span class="${v >= 1 ? 'on' : ''}"></span>`);
      }
      const el = document.createElement('div');
      el.className = 'q-quest' + (q.completed ? ' done' : '');
      el.innerHTML = `
        <div style="flex:1">
          <div class="title">${q.title} ${q.event_type ? `<small>· ${q.event_type}</small>` : ''}</div>
          <div class="q-heat">${cells.join('')}</div>
        </div>
        <div class="q-bar"><i style="width:${pct}%"></i></div>
        <span>${q.count}/${q.target_count}</span>
        <span class="q-streak">🔥${q.streak}</span>
        <button class="q-del" data-id="${q.id}">삭제</button>`;
      g.appendChild(el);
    }
    groups.appendChild(g);
  }

  groups.querySelectorAll('.q-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 퀘스트를 삭제할까요?')) return;
      await api(`/api/quests?pin=${PIN}&id=${btn.dataset.id}`, { method: 'DELETE' });
      loadAll();
    });
  });
}

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!PIN) return alert('PIN이 필요합니다');

  const appName = $('#f_app').value.trim();
  if (!appName) return alert('앱을 선택해주세요');

  // 행동 → event_type 결정
  const choice = $('#f_event').value;
  let eventType; // 미정의 = 앱 단위
  if (choice === CUSTOM) {
    eventType = $('#f_event_custom').value.trim() || undefined;
  } else if (choice && choice !== APP_LEVEL) {
    eventType = choice;
  }
  // choice === APP_LEVEL → eventType은 undefined로 유지 (event_type 미전송)

  const payload = {
    pin: PIN,
    app_name: appName,
    title: $('#f_title').value.trim(),
    target_count: parseInt($('#f_target').value, 10) || 1,
  };
  if (eventType) payload.event_type = eventType;

  const r = await api('/api/quests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return alert(r.error || '추가 실패');

  // 폼 리셋 — 드롭다운 기본값 복원
  $('#f_title').value = '';
  $('#f_event_custom').value = '';
  $('#f_target').value = '1';
  refreshEventOptions();
  loadAll();
});

initForm();
loadAll();
