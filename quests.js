// 퀘스트 페이지 로직 — PIN으로 /api/quests·/api/progress 호출.
const PIN = localStorage.getItem('jacehub_vault_pin') || '';
const FAVORITES = JSON.parse(localStorage.getItem('jacehub_favorites') || '[]');

const $ = (sel) => document.querySelector(sel);

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

async function loadAll() {
  if (!PIN || !/^\d{6}$/.test(PIN)) {
    $('#needPin').classList.remove('hidden');
    return;
  }
  // 앱 자동완성: 즐겨찾기
  $('#appList').innerHTML = FAVORITES.map((a) => `<option value="${a}">`).join('');

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
  const payload = {
    pin: PIN,
    app_name: $('#f_app').value.trim(),
    title: $('#f_title').value.trim(),
    event_type: $('#f_event').value.trim() || undefined,
    target_count: parseInt($('#f_target').value, 10) || 1,
  };
  const r = await api('/api/quests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return alert(r.error || '추가 실패');
  e.target.reset();
  $('#f_target').value = '1';
  loadAll();
});

loadAll();
