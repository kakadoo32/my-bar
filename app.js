'use strict';

const CATEGORIES = [
  '위스키', '진', '보드카', '럼', '데킬라', '브랜디', '리큐르',
  '베르무트/와인', '기타 술', '믹서/탄산', '시럽/주스', '가니시/기타',
];
const TYPES = { cocktail: '칵테일', highball: '하이볼' };
const STATUS_LABEL = { ok: '완성 가능', sub: '대체 시 가능', no: '불가' };
const STATUS_ORDER = { ok: 0, sub: 1, no: 2 };
const TAB_TITLE = { recipes: '레시피', spirits: '재료', settings: '설정' };

// ---------- 저장소 (IndexedDB) ----------
const store = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('my-bar', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('spirits')) db.createObjectStore('spirits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  tx(names, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(names, mode);
      const result = fn(t);
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  },
  getAll(name) { return this.tx([name], 'readonly', t => t.objectStore(name).getAll()); },
  put(name, obj) { return this.tx([name], 'readwrite', t => { t.objectStore(name).put(obj); }); },
  remove(name, id) { return this.tx([name], 'readwrite', t => { t.objectStore(name).delete(id); }); },
  replaceAll(spirits, recipes) {
    return this.tx(['spirits', 'recipes'], 'readwrite', t => {
      const s = t.objectStore('spirits'), r = t.objectStore('recipes');
      s.clear(); r.clear();
      spirits.forEach(x => s.put(x));
      recipes.forEach(x => r.put(x));
    });
  },
};

// ---------- 상태 ----------
const state = {
  spirits: [],
  recipes: [],
  tab: 'recipes',
  recipeFilter: { q: '', status: '', type: '' },
  spiritFilter: { q: '', owned: '' },
};

const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byName = (a, b) => a.name.localeCompare(b.name, 'ko');
const spiritById = id => state.spirits.find(s => s.id === id);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- 가능 여부 판정 ----------
// 행: ok(주재료 보유) / sub(보유한 대체 재료 있음) / missing(없음)
// 전체: ok / sub / no  (선택 재료는 판정에서 제외)
function evaluateRecipe(recipe) {
  const rows = recipe.ingredients.map(ing => {
    const main = spiritById(ing.spiritId);
    const alts = (ing.alternatives || []).map(spiritById).filter(Boolean);
    const ownedAlts = alts.filter(a => a.owned);
    let rowState = 'missing';
    if (main && main.owned) rowState = 'ok';
    else if (ownedAlts.length) rowState = 'sub';
    return { ing, main, alts, ownedAlts, state: rowState };
  });
  const required = rows.filter(r => !r.ing.optional);
  const missing = required.filter(r => r.state === 'missing');
  const subs = required.filter(r => r.state === 'sub');
  const status = missing.length ? 'no' : subs.length ? 'sub' : 'ok';
  return { rows, status, missing, subs };
}

// ---------- 공통 렌더 조각 ----------
function thumbHTML(photo, fallback, cls = 'thumb') {
  return `<div class="${cls}">${photo ? `<img src="${photo}" alt="">` : fallback}</div>`;
}

// ---------- 탭 ----------
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  $('#page-title').textContent = TAB_TITLE[tab];
  $('#btn-add').hidden = tab === 'settings';
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (state.tab === 'recipes') renderRecipes();
  else if (state.tab === 'spirits') renderSpirits();
  else renderSettings();
}

// ---------- 레시피 목록 ----------
function renderRecipes() {
  const { q, status, type } = state.recipeFilter;
  const list = $('#recipe-list');
  if (!state.recipes.length) {
    list.innerHTML = `<div class="empty"><div class="big">🍸</div>아직 레시피가 없어요.<br>오른쪽 위 ＋ 버튼으로 등록해 보세요.</div>`;
    return;
  }
  const items = state.recipes
    .map(r => ({ r, ev: evaluateRecipe(r) }))
    .filter(({ r, ev }) =>
      (!q || r.name.toLowerCase().includes(q.toLowerCase())) &&
      (!status || ev.status === status) &&
      (!type || r.type === type))
    .sort((a, b) => STATUS_ORDER[a.ev.status] - STATUS_ORDER[b.ev.status] || byName(a.r, b.r));

  if (!items.length) {
    list.innerHTML = `<div class="empty">조건에 맞는 레시피가 없어요.</div>`;
    return;
  }
  list.innerHTML = items.map(({ r, ev }) => {
    let sub = r.ingredients.map(i => spiritById(i.spiritId)?.name).filter(Boolean).join(' · ');
    if (ev.status === 'no') sub = '부족: ' + ev.missing.map(m => m.main?.name).join(', ');
    if (ev.status === 'sub') sub = '대체: ' + ev.subs.map(s => `${s.main?.name} → ${s.ownedAlts[0].name}`).join(', ');
    return `
      <button class="recipe-item" data-id="${r.id}">
        ${thumbHTML(r.photo, r.type === 'highball' ? '🥃' : '🍸')}
        <div class="item-main">
          <div class="item-title">${esc(r.name)}</div>
          <div class="item-meta">
            <span class="badge ${ev.status}">${STATUS_LABEL[ev.status]}</span>
            <span class="badge type">${TYPES[r.type]}</span>
          </div>
          <div class="item-sub">${esc(sub)}</div>
        </div>
      </button>`;
  }).join('');
}

// ---------- 재료 목록 ----------
function renderSpirits() {
  const { q, owned } = state.spiritFilter;
  const list = $('#spirit-list');
  if (!state.spirits.length) {
    list.innerHTML = `<div class="empty"><div class="big">🍾</div>등록된 재료가 없어요.<br>오른쪽 위 ＋ 버튼으로 술이나 재료를 등록해 보세요.</div>`;
    return;
  }
  const filtered = state.spirits.filter(s =>
    (!q || s.name.toLowerCase().includes(q.toLowerCase())) &&
    (owned === '' || String(Number(s.owned)) === owned));
  if (!filtered.length) {
    list.innerHTML = `<div class="empty">조건에 맞는 재료가 없어요.</div>`;
    return;
  }
  list.innerHTML = CATEGORIES.map(cat => {
    const items = filtered.filter(s => s.category === cat).sort(byName);
    if (!items.length) return '';
    const ownedCount = items.filter(s => s.owned).length;
    return `
      <div class="group-title">${esc(cat)} · ${ownedCount}/${items.length} 보유</div>
      <div class="group">
        ${items.map(s => `
          <div class="spirit-row">
            <button class="spirit-open" data-id="${s.id}">
              ${thumbHTML(s.photo, '🍾', 'thumb sm')}
              <div class="item-main">
                <div class="item-title">${esc(s.name)}</div>
                ${s.memo ? `<div class="item-sub">${esc(s.memo)}</div>` : ''}
              </div>
            </button>
            <input type="checkbox" class="switch" data-owned-toggle="${s.id}" ${s.owned ? 'checked' : ''} aria-label="${esc(s.name)} 보유 여부">
          </div>`).join('')}
      </div>`;
  }).join('');
}

// ---------- 설정 ----------
function renderSettings() {
  const evs = state.recipes.map(evaluateRecipe);
  const count = st => evs.filter(e => e.status === st).length;
  $('#stats').innerHTML = [
    [state.spirits.length, '등록 재료'],
    [state.spirits.filter(s => s.owned).length, '보유 재료'],
    [state.recipes.length, '레시피'],
    [count('ok'), '완성 가능'],
    [count('sub'), '대체 시 가능'],
    [count('no'), '불가'],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
}

// ---------- 사진 ----------
function resizeImage(file, max = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요.')); };
    img.src = url;
  });
}

function setupPhotoField(prefix) {
  const preview = $(`#${prefix}-photo-preview`);
  const input = $(`#${prefix}-photo`);
  const field = {
    value: null,
    set(v) {
      this.value = v;
      preview.querySelectorAll('img, span').forEach(n => n.remove());
      preview.classList.toggle('has-photo', !!v);
      preview.insertAdjacentHTML('beforeend', v ? `<img src="${v}" alt="">` : '<span>사진 추가<br>(탭하여 선택)</span>');
      $(`#${prefix}-photo-clear`).hidden = !v;
    },
  };
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try { field.set(await resizeImage(file)); }
    catch (e) { alert(e.message); }
  });
  $(`#${prefix}-photo-clear`).addEventListener('click', () => field.set(null));
  return field;
}

// ---------- 재료 폼 ----------
const spiritPhoto = setupPhotoField('spirit');
let editingSpiritId = null;

function usedIn(spiritId) {
  return state.recipes.filter(r => r.ingredients.some(i =>
    i.spiritId === spiritId || (i.alternatives || []).includes(spiritId)));
}

function openSpiritForm(id = null) {
  const s = id ? spiritById(id) : null;
  editingSpiritId = id;
  const form = $('#form-spirit');
  form.reset();
  $('#spirit-form-title').textContent = s ? '재료 수정' : '재료 등록';
  form.name.value = s?.name ?? '';
  form.category.value = s?.category ?? CATEGORIES[0];
  form.owned.checked = s ? s.owned : true;
  form.memo.value = s?.memo ?? '';
  spiritPhoto.set(s?.photo ?? null);
  $('#spirit-delete').hidden = !s;
  const used = s ? usedIn(s.id) : [];
  $('#spirit-usage').textContent = used.length ? `사용 중인 레시피: ${used.map(r => r.name).join(', ')}` : '';
  $('#dlg-spirit').showModal();
}

$('#form-spirit').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  if (!name) { form.name.focus(); return; }
  const dup = state.spirits.find(s => s.name === name && s.id !== editingSpiritId);
  if (dup && !confirm(`'${name}' 이름의 재료가 이미 있어요. 그래도 저장할까요?`)) return;
  const prev = editingSpiritId ? spiritById(editingSpiritId) : null;
  const now = Date.now();
  const spirit = {
    id: prev?.id ?? uid(),
    name,
    category: form.category.value,
    owned: form.owned.checked,
    memo: form.memo.value.trim(),
    photo: spiritPhoto.value,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await store.put('spirits', spirit);
  if (prev) Object.assign(prev, spirit); else state.spirits.push(spirit);
  $('#dlg-spirit').close();
  render();
  toast(prev ? '재료를 수정했어요' : '재료를 등록했어요');
});

$('#spirit-delete').addEventListener('click', async () => {
  const s = spiritById(editingSpiritId);
  if (!s) return;
  const used = usedIn(s.id);
  if (used.length) {
    alert(`이 재료는 다음 레시피에서 사용 중이라 삭제할 수 없어요.\n\n${used.map(r => '· ' + r.name).join('\n')}\n\n레시피에서 먼저 빼 주세요.`);
    return;
  }
  if (!confirm(`'${s.name}'을(를) 삭제할까요?`)) return;
  await store.remove('spirits', s.id);
  state.spirits = state.spirits.filter(x => x.id !== s.id);
  $('#dlg-spirit').close();
  render();
  toast('재료를 삭제했어요');
});

$('#spirit-list').addEventListener('click', e => {
  const open = e.target.closest('.spirit-open');
  if (open) openSpiritForm(open.dataset.id);
});

$('#spirit-list').addEventListener('change', async e => {
  const id = e.target.dataset.ownedToggle;
  if (!id) return;
  const s = spiritById(id);
  s.owned = e.target.checked;
  s.updatedAt = Date.now();
  await store.put('spirits', s);
  // 그룹 제목의 보유 개수, 보유/미보유 필터 반영
  renderSpirits();
});

// ---------- 레시피 폼 ----------
const recipePhoto = setupPhotoField('recipe');
let editingRecipeId = null;
let ingRows = [];

function newIngRow() {
  return { spiritId: '', amount: '', optional: false, alternatives: [] };
}

function renderIngRows() {
  $('#ing-rows').innerHTML = ingRows.map((row, i) => {
    const altChips = row.alternatives.map(id => {
      const s = spiritById(id);
      return s ? `<span class="alt-chip">${esc(s.name)}${s.owned ? ' ✓' : ''}<button type="button" data-act="rm-alt" data-alt="${id}" aria-label="대체 재료 빼기">×</button></span>` : '';
    }).join('');
    const main = spiritById(row.spiritId);
    return `
      <div class="ing-row" data-i="${i}">
        <div class="ing-main">
          <button type="button" class="pick-btn${main ? '' : ' empty'}" data-act="pick-main" aria-label="재료 선택">${main ? `${esc(main.name)}${main.owned ? ' ✓' : ''}` : '재료 선택'}</button>
          <input data-f="amount" value="${esc(row.amount)}" placeholder="양 (45ml)" aria-label="양">
          <button type="button" class="ing-remove" data-act="rm-row" aria-label="재료 행 삭제">✕</button>
        </div>
        <label class="ing-opts"><input type="checkbox" data-f="optional" ${row.optional ? 'checked' : ''}> 선택 재료 (없어도 만들 수 있음)</label>
        <div class="ing-alts">
          <span class="lbl">대체:</span>
          ${altChips}
          <button type="button" class="pick-btn alt" data-act="pick-alt">＋ 대체 재료 추가</button>
        </div>
      </div>`;
  }).join('');
}

function openRecipeForm(id = null) {
  const r = id ? state.recipes.find(x => x.id === id) : null;
  editingRecipeId = id;
  const form = $('#form-recipe');
  form.reset();
  $('#recipe-form-title').textContent = r ? '레시피 수정' : '레시피 등록';
  form.name.value = r?.name ?? '';
  form.querySelector(`input[name="type"][value="${r?.type ?? 'cocktail'}"]`).checked = true;
  form.glass.value = r?.glass ?? '';
  form.steps.value = r?.steps ?? '';
  recipePhoto.set(r?.photo ?? null);
  ingRows = r ? r.ingredients.map(i => ({ ...i, alternatives: [...(i.alternatives || [])] })) : [newIngRow()];
  $('#recipe-delete').hidden = !r;
  renderIngRows();
  $('#dlg-recipe').showModal();
}

$('#btn-add-ing').addEventListener('click', () => {
  ingRows.push(newIngRow());
  renderIngRows();
});

$('#ing-rows').addEventListener('input', e => {
  const rowEl = e.target.closest('.ing-row');
  if (rowEl && e.target.dataset.f === 'amount') ingRows[rowEl.dataset.i].amount = e.target.value;
});

$('#ing-rows').addEventListener('change', e => {
  const rowEl = e.target.closest('.ing-row');
  if (!rowEl) return;
  if (e.target.dataset.f === 'optional') ingRows[rowEl.dataset.i].optional = e.target.checked;
});

$('#ing-rows').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = Number(btn.closest('.ing-row').dataset.i);
  const row = ingRows[i];
  const act = btn.dataset.act;
  if (act === 'rm-row') ingRows.splice(i, 1);
  else if (act === 'rm-alt') row.alternatives = row.alternatives.filter(a => a !== btn.dataset.alt);
  else if (act === 'pick-main') {
    const id = await pickSpirit({ title: '재료 선택', selectedId: row.spiritId });
    if (!id) return;
    row.spiritId = id;
    row.alternatives = row.alternatives.filter(a => a !== id);
  } else if (act === 'pick-alt') {
    const id = await pickSpirit({ title: '대체 재료 선택', excludeIds: [row.spiritId, ...row.alternatives] });
    if (!id) return;
    row.alternatives.push(id);
  }
  renderIngRows();
});

// ---------- 재료 선택 시트 (검색 + 바로 등록) ----------
// 검색은 띄어쓰기·대소문자를 무시하고 이름이나 분류에 포함되면 보여 준다.
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
let pick = null; // { selectedId, excludeIds, resolve, creating }
let pickNewCat = CATEGORIES[0];
let pickNewOwned = false;

function pickSpirit({ title, selectedId = '', excludeIds = [] }) {
  return new Promise(resolve => {
    pick = { selectedId, excludeIds, resolve, creating: false };
    $('#pick-title').textContent = title;
    $('#pick-q').value = '';
    renderPickList();
    $('#dlg-pick').showModal();
    $('#pick-list').scrollTop = 0;
    $('#pick-q').focus();
  });
}

function finishPick(id) {
  const p = pick;
  pick = null;
  $('#dlg-pick').close();
  p?.resolve(id);
}

function renderPickList() {
  const raw = $('#pick-q').value.trim();
  const q = norm(raw);
  const items = state.spirits.filter(s => !pick.excludeIds.includes(s.id) &&
    (!q || norm(s.name).includes(q) || norm(s.category).includes(q)));
  const groups = CATEGORIES.map(cat => {
    const list = items.filter(s => s.category === cat).sort(byName);
    if (!list.length) return '';
    return `
      <div class="group-title">${esc(cat)}</div>
      <div class="group">${list.map(s => `
        <button type="button" class="pick-item${s.id === pick.selectedId ? ' selected' : ''}" data-id="${s.id}">
          <span class="item-title">${esc(s.name)}</span>${s.owned ? '<span class="badge ok">보유</span>' : ''}
        </button>`).join('')}
      </div>`;
  }).join('');
  const canCreate = raw && !state.spirits.some(s => norm(s.name) === q);
  const createHTML = canCreate ? `
    <div class="pick-new">
      <div class="pick-new-title">‘${esc(raw)}’ 새 재료로 등록</div>
      <div class="pick-new-row">
        <select id="pick-new-cat" aria-label="분류">${CATEGORIES.map(c =>
          `<option${c === pickNewCat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label class="pick-new-owned"><input type="checkbox" id="pick-new-owned"${pickNewOwned ? ' checked' : ''}> 보유 중</label>
      </div>
      <button type="button" class="primary block" id="pick-create">등록하고 선택</button>
    </div>` : '';
  let emptyHTML = '';
  if (!items.length && !canCreate) {
    emptyHTML = `<div class="empty">${state.spirits.length ? '선택할 수 있는 재료가 없어요.' : '등록된 재료가 없어요.'}<br>위에 이름을 입력하면 바로 등록할 수 있어요.</div>`;
  }
  $('#pick-list').innerHTML = groups + createHTML + emptyHTML;
}

async function createSpiritFromPick() {
  const name = $('#pick-q').value.trim();
  if (!name || !pick || pick.creating) return;
  pick.creating = true;
  const now = Date.now();
  const spirit = { id: uid(), name, category: pickNewCat, owned: pickNewOwned, memo: '', photo: null, createdAt: now, updatedAt: now };
  await store.put('spirits', spirit);
  state.spirits.push(spirit);
  toast('재료를 등록했어요');
  finishPick(spirit.id);
}

$('#dlg-pick').addEventListener('close', () => { if (pick) finishPick(null); });
$('#pick-q').addEventListener('input', renderPickList);
$('#pick-q').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  // 결과가 하나면 그걸 선택, 결과가 없으면 새 재료로 등록
  const items = $('#pick-list').querySelectorAll('.pick-item');
  if (items.length === 1) finishPick(items[0].dataset.id);
  else if (!items.length && $('#pick-create')) createSpiritFromPick();
});
$('#pick-list').addEventListener('click', e => {
  const item = e.target.closest('.pick-item');
  if (item) finishPick(item.dataset.id);
  else if (e.target.closest('#pick-create')) createSpiritFromPick();
});
$('#pick-list').addEventListener('change', e => {
  if (e.target.id === 'pick-new-cat') pickNewCat = e.target.value;
  if (e.target.id === 'pick-new-owned') pickNewOwned = e.target.checked;
});

$('#form-recipe').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  if (!name) { form.name.focus(); return; }
  const ingredients = ingRows
    .filter(r => r.spiritId)
    .map(r => ({ spiritId: r.spiritId, amount: r.amount.trim(), optional: r.optional, alternatives: r.alternatives }));
  if (!ingredients.length) { alert('재료를 하나 이상 선택해 주세요.'); return; }
  const prev = editingRecipeId ? state.recipes.find(x => x.id === editingRecipeId) : null;
  const now = Date.now();
  const recipe = {
    id: prev?.id ?? uid(),
    name,
    type: form.type.value,
    glass: form.glass.value.trim(),
    steps: form.steps.value.trim(),
    photo: recipePhoto.value,
    ingredients,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await store.put('recipes', recipe);
  if (prev) Object.assign(prev, recipe); else state.recipes.push(recipe);
  $('#dlg-recipe').close();
  render();
  if ($('#dlg-detail').open) renderDetail(recipe.id);
  toast(prev ? '레시피를 수정했어요' : '레시피를 등록했어요');
});

$('#recipe-delete').addEventListener('click', async () => {
  const r = state.recipes.find(x => x.id === editingRecipeId);
  if (!r || !confirm(`'${r.name}' 레시피를 삭제할까요?`)) return;
  await store.remove('recipes', r.id);
  state.recipes = state.recipes.filter(x => x.id !== r.id);
  $('#dlg-recipe').close();
  if ($('#dlg-detail').open) $('#dlg-detail').close();
  render();
  toast('레시피를 삭제했어요');
});

// ---------- 레시피 상세 ----------
let detailId = null;

function renderDetail(id) {
  const r = state.recipes.find(x => x.id === id);
  if (!r) return;
  detailId = id;
  const ev = evaluateRecipe(r);
  $('#detail-title').textContent = r.name;

  let verdict = '';
  if (ev.status === 'ok') {
    verdict = `<div class="verdict ok"><div class="v-title">✅ 완성 가능</div>필요한 재료를 모두 가지고 있어요.</div>`;
  } else if (ev.status === 'sub') {
    verdict = `<div class="verdict sub"><div class="v-title">🔄 대체하면 가능</div>아래처럼 바꾸면 만들 수 있어요.
      <ul>${ev.subs.map(s => `<li><b>${esc(s.main?.name)}</b> 대신 <b>${s.ownedAlts.map(a => esc(a.name)).join(' 또는 ')}</b></li>`).join('')}</ul></div>`;
  } else {
    verdict = `<div class="verdict no"><div class="v-title">❌ 불가</div>다음 재료가 없어요.
      <ul>${ev.missing.map(m => `<li><b>${esc(m.main?.name)}</b>${m.alts.length ? ` <span class="small">(대체 후보 ${m.alts.map(a => esc(a.name)).join(', ')}도 없음)</span>` : ''}</li>`).join('')}</ul>
      ${ev.subs.length ? `<div class="small" style="margin-top:6px">대체로 해결되는 재료: ${ev.subs.map(s => `${esc(s.main?.name)} → ${esc(s.ownedAlts[0].name)}`).join(', ')}</div>` : ''}</div>`;
  }

  const rows = ev.rows.map(row => {
    const { ing, main, alts, ownedAlts } = row;
    let icon = 'ok', mark = '✓', note = '';
    if (row.state === 'sub') {
      icon = 'sub'; mark = '↺';
      note = `없음 → 대체: <b class="sub">${ownedAlts.map(a => esc(a.name)).join(', ')}</b> (보유)`;
    } else if (row.state === 'missing') {
      icon = ing.optional ? 'opt' : 'no'; mark = ing.optional ? '–' : '✕';
      note = alts.length ? `없음 · 대체 후보 ${alts.map(a => esc(a.name)).join(', ')}도 미보유` : '없음 · 등록된 대체 재료 없음';
    } else if (alts.length) {
      note = `대체 가능: ${alts.map(a => esc(a.name) + (a.owned ? ' ✓' : '')).join(', ')}`;
    }
    return `
      <div class="ing-item">
        <div class="ing-state ${icon}">${mark}</div>
        <div class="ing-body">
          <div class="ing-name">${esc(main?.name ?? '(삭제된 재료)')}${ing.amount ? `<span class="ing-amount">${esc(ing.amount)}</span>` : ''}${ing.optional ? '<span class="tag">선택</span>' : ''}</div>
          ${note ? `<div class="ing-note">${note}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  $('#detail-body').innerHTML = `
    <div class="detail-photo${r.photo ? '' : ' empty'}">${r.photo ? `<img src="${r.photo}" alt="">` : (r.type === 'highball' ? '🥃' : '🍸')}</div>
    <div class="item-meta" style="margin-bottom:12px">
      <span class="badge type">${TYPES[r.type]}</span>
      ${r.glass ? `<span class="badge type">${esc(r.glass)}</span>` : ''}
    </div>
    ${verdict}
    <div class="section-title">재료</div>
    <div class="ing-list">${rows}</div>
    ${r.steps ? `<div class="section-title">만드는 법</div><div class="steps">${esc(r.steps)}</div>` : ''}`;
}

$('#recipe-list').addEventListener('click', e => {
  const item = e.target.closest('.recipe-item');
  if (!item) return;
  renderDetail(item.dataset.id);
  $('#detail-body').scrollTop = 0;
  $('#dlg-detail').showModal();
});
$('#detail-edit').addEventListener('click', () => openRecipeForm(detailId));

// ---------- 백업 ----------
function backupFileName() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `my-bar-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

$('#btn-export').addEventListener('click', async () => {
  const data = { app: 'my-bar', version: 1, exportedAt: new Date().toISOString(), spirits: state.spirits, recipes: state.recipes };
  const name = backupFileName();
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 저장했어요');
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== 'my-bar' || !Array.isArray(data.spirits) || !Array.isArray(data.recipes)) throw new Error();
  } catch {
    alert('My Bar 백업 파일이 아니거나 파일이 손상되었어요.');
    return;
  }
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
  if (!confirm(`백업 시각: ${when}\n재료 ${data.spirits.length}개 · 레시피 ${data.recipes.length}개\n\n현재 데이터를 모두 지우고 이 백업으로 바꿀까요?`)) return;
  await store.replaceAll(data.spirits, data.recipes);
  state.spirits = data.spirits;
  state.recipes = data.recipes;
  render();
  toast('백업에서 복원했어요');
});

// ---------- 필터 / 공통 이벤트 ----------
function bindChips(containerSel, key, filter) {
  $(containerSel).addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $(containerSel).querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    filter[key] = chip.dataset[key];
    render();
  });
}
bindChips('#recipe-status-chips', 'status', state.recipeFilter);
bindChips('#recipe-type-chips', 'type', state.recipeFilter);
bindChips('#spirit-owned-chips', 'owned', state.spiritFilter);
$('#recipe-q').addEventListener('input', e => { state.recipeFilter.q = e.target.value.trim(); renderRecipes(); });
$('#spirit-q').addEventListener('input', e => { state.spiritFilter.q = e.target.value.trim(); renderSpirits(); });

document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('#btn-add').addEventListener('click', () => (state.tab === 'spirits' ? openSpiritForm() : openRecipeForm()));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#spirit-cat-input').innerHTML = CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('');

// ---------- 시작 ----------
(async function init() {
  try {
    await store.open();
    [state.spirits, state.recipes] = await Promise.all([store.getAll('spirits'), store.getAll('recipes')]);
  } catch (e) {
    alert('데이터를 불러오지 못했어요: ' + e.message);
  }
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
