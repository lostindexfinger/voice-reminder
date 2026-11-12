(function () {
  'use strict';

  var Parser = window.SmartKoreanParser;
  var $ = function (id) { return document.getElementById(id); };

  // ---------- 저장소 ----------
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('vr.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('vr.' + key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경에서도 동작은 계속 */ }
    }
  };

  var DEFAULT_SHORTCUT = 'ReminderAdd';
  var places = store.get('places', null) || JSON.parse(JSON.stringify(Parser.DEFAULT_PLACES));
  var settings = Object.assign({ autoMic: false, autoSave: false, shortcutName: DEFAULT_SHORTCUT, connected: false }, store.get('settings', {}));
  var history = store.get('history', []);
  var drafts = [];

  function saveSettings() { store.set('settings', settings); }
  function savePlaces() { store.set('places', places); renderLauncherUrl(); }

  // ---------- 주소로 전달되는 설정 (동작 버튼용) ----------
  function encodeConfig(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeConfig(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  // 주소·받아쓴 문장이 서버로 전송되지 않도록 # 뒤(프래그먼트)를 우선 읽습니다.
  var params = new URLSearchParams(location.hash.length > 1 ? location.hash.slice(1) : location.search);
  if (params.get('c')) {
    try {
      var cfg = decodeConfig(params.get('c'));
      if (Array.isArray(cfg.p)) {
        places = cfg.p.map(function (p) { return { name: p.n, aliases: p.a || [], address: p.d || '', icon: p.i || '📍' }; });
        store.set('places', places);
      }
      if (cfg.s) { settings.shortcutName = cfg.s; settings.connected = true; saveSettings(); }
    } catch (e) { /* 잘못된 설정 값은 무시 */ }
  }

  // ---------- 도우미 ----------
  var toastTimer;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function toShortcutDate(d) { return toLocalInput(d).replace('T', ' '); }
  function formatKoreanDate(d) {
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    var h = d.getHours();
    var ampm = h < 12 ? '오전' : '오후';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + days[d.getDay()] + ') ' + ampm + ' ' + h12 + ':' + pad(d.getMinutes());
  }
  function proximityLabel(p) { return p === 'leaving' ? '출발할 때' : '도착할 때'; }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---------- 해석 결과 → 단축어에 넘길 항목 ----------
  // locationKey: '' (없음) | 'p:장소이름' (저장된 장소) | 'd:키워드' (저장되지 않은 장소)
  function draftFromParsed(p) {
    return {
      title: p.title,
      date: p.dueDate,
      locationKey: p.place ? 'p:' + p.place.name : (p.dynamicPlaceName ? 'd:' + p.dynamicPlaceName : ''),
      proximity: p.proximity,
      priority: p.priority
    };
  }

  function resolveLocation(draft) {
    if (!draft.locationKey) return null;
    var kind = draft.locationKey.slice(0, 2);
    var name = draft.locationKey.slice(2);
    if (kind === 'd:') return { label: name, query: name, missing: false };
    var place = places.filter(function (p) { return p.name === name; })[0];
    if (!place) return null;
    var address = (place.address || '').trim();
    return { label: place.name, query: address, missing: !address };
  }

  function toPayloadItem(draft) {
    var loc = resolveLocation(draft);
    var notes = [];
    var item = { title: (draft.priority ? '❗️ ' : '') + draft.title.trim(), notes: '', kind: 'none', date: '', place: '' };

    if (loc && !loc.missing) {
      item.kind = draft.proximity === 'leaving' ? 'leave' : 'arrive';
      item.place = loc.query;
      // 단축어의 미리알림은 알림 조건을 하나만 가질 수 있어, 시간은 메모로 남깁니다.
      if (draft.date) notes.push('⏰ ' + formatKoreanDate(draft.date));
    } else {
      if (draft.date) { item.kind = 'time'; item.date = toShortcutDate(draft.date); }
      if (loc && loc.missing) notes.push('📍 ' + loc.label + ' ' + proximityLabel(draft.proximity) + ' (주소 미설정)');
    }
    item.notes = notes.join('\n');
    return item;
  }

  function buildPayload(list) {
    return { items: list.filter(function (d) { return d.title.trim(); }).map(toPayloadItem) };
  }

  function shortcutUrl(payload) {
    return 'shortcuts://run-shortcut?name=' + encodeURIComponent(settings.shortcutName || DEFAULT_SHORTCUT) +
      '&input=text&text=' + encodeURIComponent(JSON.stringify(payload));
  }

  function sendToShortcut(payload, label) {
    if (!payload.items.length) { toast('등록할 내용이 없습니다'); return false; }
    history.unshift({ at: Date.now(), titles: payload.items.map(function (i) { return i.title; }), label: label || '' });
    history = history.slice(0, 30);
    store.set('history', history);
    renderHistory();
    window.location.href = shortcutUrl(payload);
    return true;
  }

  // ---------- 음성 입력 탭 ----------
  var input = $('input');
  var parseTimer;

  function parseNow() {
    var text = input.value.trim();
    drafts = text ? Parser.parseMultiple(text, { places: places }).map(draftFromParsed) : [];
    renderDrafts();
  }
  function scheduleParse() { clearTimeout(parseTimer); parseTimer = setTimeout(parseNow, 250); }

  function renderDrafts() {
    var box = $('drafts');
    box.textContent = '';
    $('preview').hidden = drafts.length === 0;
    $('tips').hidden = drafts.length > 0;
    if (!drafts.length) return;
    $('preview-count').textContent = '자동 분석된 미리알림 (' + drafts.length + '건)';

    drafts.forEach(function (draft, index) {
      var loc = resolveLocation(draft);
      var tags = el('div', { class: 'tags' });
      if (loc && !loc.missing) tags.appendChild(el('span', { class: 'tag loc', text: '📍 ' + loc.label + ' ' + proximityLabel(draft.proximity) }));
      if (loc && loc.missing) tags.appendChild(el('span', { class: 'tag warn', text: '📍 ' + loc.label + ' 주소 미설정 → 위치 알림 없이 등록' }));
      if (draft.date) tags.appendChild(el('span', { class: 'tag', text: '⏰ ' + formatKoreanDate(draft.date) + (loc && !loc.missing ? ' (메모로 기록)' : '') }));
      if (draft.priority) tags.appendChild(el('span', { class: 'tag warn', text: '❗️ 중요' }));
      if (!loc && !draft.date) tags.appendChild(el('span', { class: 'tag', text: '알림 조건 없음' }));

      var titleInput = el('input', { type: 'text', value: draft.title, 'aria-label': '할 일 제목', oninput: function (e) { draft.title = e.target.value; } });
      titleInput.value = draft.title;

      var dateInput = el('input', { type: 'datetime-local', 'aria-label': '알림 시간', onchange: function (e) {
        draft.date = e.target.value ? new Date(e.target.value) : null;
        renderDrafts();
      } });
      if (draft.date) dateInput.value = toLocalInput(draft.date);

      var select = el('select', { 'aria-label': '장소', onchange: function (e) { draft.locationKey = e.target.value; renderDrafts(); } });
      select.appendChild(el('option', { value: '', text: '장소 없음' }));
      places.forEach(function (p) {
        select.appendChild(el('option', { value: 'p:' + p.name, text: (p.icon || '📍') + ' ' + p.name + (p.address ? '' : ' (주소 미설정)') }));
      });
      if (draft.locationKey.indexOf('d:') === 0) {
        select.appendChild(el('option', { value: draft.locationKey, text: '🔎 ' + draft.locationKey.slice(2) + ' (지도 검색)' }));
      }
      select.value = draft.locationKey;

      var seg = el('div', { class: 'seg' }, ['arriving', 'leaving'].map(function (p) {
        return el('button', { type: 'button', class: draft.proximity === p ? 'on' : '', text: proximityLabel(p), onclick: function () { draft.proximity = p; renderDrafts(); } });
      }));

      var grid = el('div', { class: 'grid' }, [
        el('span', { text: '시간' }),
        el('div', { class: 'with-clear' }, [dateInput, draft.date ? el('button', { type: 'button', class: 'icon-btn', 'aria-label': '시간 지우기', text: '×', onclick: function () { draft.date = null; renderDrafts(); } }) : null]),
        el('span', { text: '장소' }),
        select,
        draft.locationKey ? el('span', { text: '조건' }) : null,
        draft.locationKey ? seg : null
      ]);

      box.appendChild(el('div', { class: 'draft' }, [
        el('div', { class: 'title-row' }, [
          titleInput,
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': '이 항목 삭제', text: '🗑', onclick: function () { drafts.splice(index, 1); renderDrafts(); } })
        ]),
        tags,
        grid
      ]));
    });

    $('register').textContent = '미리알림에 등록' + (drafts.length > 1 ? ' (' + drafts.length + '건)' : '');
    $('register-hint').textContent = '"' + (settings.shortcutName || DEFAULT_SHORTCUT) + '" 단축어가 열리면서 등록됩니다';
  }

  function registerDrafts() {
    if (sendToShortcut(buildPayload(drafts))) pendingClear = true;
  }

  // 단축어 앱으로 실제로 넘어갔을 때만 입력을 비웁니다. (넘어가지 못하면 내용이 남아 다시 시도할 수 있습니다)
  var pendingClear = false;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && pendingClear) {
      pendingClear = false;
      input.value = '';
      drafts = [];
      renderDrafts();
      if (!settings.connected) { settings.connected = true; saveSettings(); renderStatus(); }
    }
  });

  // 샘플 문구
  [
    ['🏠 집 도착', '집 도착했을 때 세탁기 돌리기'],
    ['🎓 학교 도착', '학교 도착하면 교수님께 과제 제출하기'],
    ['☂️ 집 출발', '집에서 출발할 때 우산 챙기기'],
    ['⏰ 내일 3시', '내일 오후 3시에 치과 예약하기'],
    ['🔥 복합 명령', '퇴근할 때 우유 사기 그리고 집 도착했을 때 택배 확인하기']
  ].forEach(function (s) {
    $('sample-chips').appendChild(el('button', { type: 'button', text: s[0], onclick: function () { input.value = s[1]; parseNow(); } }));
  });

  input.addEventListener('input', scheduleParse);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); input.blur(); parseNow(); }
  });
  $('register').addEventListener('click', registerDrafts);

  // ---------- 음성 인식 ----------
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var listening = false;
  var mic = $('mic');

  function setListening(on) {
    listening = on;
    mic.classList.toggle('listening', on);
    $('mic-label').textContent = on ? '듣는 중… 눌러서 끝내기' : '눌러서 말하기';
  }
  function micHint(text) { $('mic-hint').textContent = text; $('mic-hint').hidden = !text; }

  function startListening() {
    if (!SpeechRecognition || listening) return;
    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = false;
    var finalText = '';
    recognition.onresult = function (e) {
      var text = '';
      for (var i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      finalText = text;
      input.value = text;
      scheduleParse();
    };
    recognition.onerror = function (e) {
      setListening(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        micHint('마이크·음성 인식 권한이 없습니다. 아래 입력칸을 누르고 키보드의 마이크 버튼으로 말해 주세요.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        micHint('음성 인식을 시작하지 못했습니다. 키보드의 마이크 버튼으로 말해 주세요.');
      }
    };
    recognition.onend = function () {
      setListening(false);
      clearTimeout(parseTimer);
      parseNow();
      if (settings.autoSave && finalText.trim() && drafts.length) registerDrafts();
    };
    try {
      recognition.start();
      setListening(true);
      micHint('');
    } catch (e) {
      setListening(false);
    }
  }

  if (SpeechRecognition) {
    mic.addEventListener('click', function () {
      if (listening) recognition.stop(); else startListening();
    });
  } else {
    mic.disabled = true;
    $('mic-label').textContent = '음성 버튼 미지원';
    micHint('이 브라우저는 음성 버튼을 지원하지 않습니다. 아래 입력칸을 누르고 키보드의 마이크 버튼으로 말해 주세요.');
  }

  // ---------- 설정 토글 · 연결 상태 ----------
  function renderStatus() {
    $('status-dot').classList.toggle('ok', !!settings.connected);
    $('status-text').textContent = settings.connected ? '단축어 연결됨' : '단축어 연결 확인 필요';
    $('status-action').hidden = !!settings.connected;
  }
  $('status-action').addEventListener('click', function () { showTab('connect'); });
  $('opt-auto-mic').checked = settings.autoMic;
  $('opt-auto-save').checked = settings.autoSave;
  $('opt-auto-mic').addEventListener('change', function (e) { settings.autoMic = e.target.checked; saveSettings(); });
  $('opt-auto-save').addEventListener('change', function (e) { settings.autoSave = e.target.checked; saveSettings(); });

  // ---------- 내 장소 탭 ----------
  function renderPlaces() {
    var list = $('place-list');
    list.textContent = '';
    places.forEach(function (place, index) {
      var state = el('span', { class: 'state' + (place.address ? ' ok' : ''), text: place.address ? '설정됨' : '주소 필요' });

      var nameInput = el('input', { type: 'text', 'aria-label': '장소 이름', onchange: function (e) {
        var v = e.target.value.trim();
        if (!v) { e.target.value = place.name; return; }
        place.name = v; savePlaces(); renderPlaces();
      } });
      nameInput.value = place.name;

      var aliasInput = el('input', { type: 'text', placeholder: '예: 우리집, 자취방, 본가', onchange: function (e) {
        place.aliases = e.target.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        savePlaces();
      } });
      aliasInput.value = (place.aliases || []).join(', ');

      var addressInput = el('input', { type: 'text', placeholder: '예: 서울특별시 강남구 테헤란로 152', onchange: function (e) {
        place.address = e.target.value.trim(); savePlaces(); renderPlaces();
      } });
      addressInput.value = place.address || '';

      list.appendChild(el('section', { class: 'card place' }, [
        el('div', { class: 'place-head' }, [
          el('span', { text: place.icon || '📍' }),
          el('strong', { text: place.name }),
          state,
          el('button', { type: 'button', class: 'icon-btn', 'aria-label': place.name + ' 삭제', text: '🗑', onclick: function () {
            if (confirm('"' + place.name + '" 장소를 삭제할까요?')) { places.splice(index, 1); savePlaces(); renderPlaces(); }
          } })
        ]),
        el('label', { class: 'field' }, [el('span', { text: '장소 이름 (말할 때 쓰는 단어)' }), nameInput]),
        el('label', { class: 'field' }, [el('span', { text: '별칭 (쉼표로 구분)' }), aliasInput]),
        el('label', { class: 'field' }, [el('span', { text: '주소 또는 건물 이름' }), addressInput]),
        el('button', { type: 'button', class: 'secondary', text: '📡 현재 위치 좌표로 채우기', onclick: function () {
          if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않습니다'); return; }
          toast('현재 위치 확인 중…');
          navigator.geolocation.getCurrentPosition(function (pos) {
            place.address = pos.coords.latitude.toFixed(6) + ',' + pos.coords.longitude.toFixed(6);
            savePlaces(); renderPlaces();
            toast('좌표를 넣었습니다. 주소를 아시면 주소로 바꾸는 편이 더 정확합니다');
          }, function () { toast('위치를 가져오지 못했습니다. 위치 권한을 확인해 주세요'); }, { enableHighAccuracy: true, timeout: 10000 });
        } })
      ]));
    });
  }

  $('add-place').addEventListener('click', function () {
    var name = (prompt('장소 이름을 적어 주세요 (예: 도서관, 마트, 교회)') || '').trim();
    if (!name) return;
    if (places.some(function (p) { return p.name === name; })) { toast('이미 있는 이름입니다'); return; }
    places.push({ name: name, aliases: [], address: '', icon: '📍' });
    savePlaces(); renderPlaces();
  });

  // ---------- 연결·기록 탭 ----------
  function launcherUrl() {
    var cfg = {
      s: settings.shortcutName || DEFAULT_SHORTCUT,
      p: places.map(function (p) { return { n: p.name, a: p.aliases || [], d: p.address || '', i: p.icon || '📍' }; })
    };
    return location.origin + location.pathname + '#c=' + encodeConfig(cfg) + '&auto=1&text=';
  }
  function renderLauncherUrl() { $('launcher-url').value = launcherUrl(); }

  $('shortcut-name').value = settings.shortcutName;
  $('shortcut-name').addEventListener('change', function (e) {
    settings.shortcutName = e.target.value.trim() || DEFAULT_SHORTCUT;
    e.target.value = settings.shortcutName;
    saveSettings(); renderLauncherUrl(); renderDrafts();
  });
  $('test-shortcut').addEventListener('click', function () {
    sendToShortcut({ items: [{ title: '음성 미리알림 연결 테스트', notes: '이 항목이 보이면 연결 성공입니다. 지워도 됩니다.', kind: 'none', date: '', place: '' }] }, '테스트');
  });
  $('mark-connected').addEventListener('click', function () {
    settings.connected = true; saveSettings(); renderStatus(); toast('연결됨으로 표시했습니다');
  });
  $('copy-launcher').addEventListener('click', function () {
    var url = launcherUrl();
    var done = function () { toast('주소를 복사했습니다'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { $('launcher-url').select(); toast('복사하지 못했습니다. 길게 눌러 복사해 주세요'); });
    } else {
      $('launcher-url').select(); document.execCommand('copy'); done();
    }
  });

  function renderHistory() {
    var list = $('history');
    list.textContent = '';
    if (!history.length) { list.appendChild(el('li', { class: 'empty', text: '아직 보낸 항목이 없습니다' })); return; }
    history.forEach(function (h) {
      list.appendChild(el('li', {}, [
        document.createTextNode(h.titles.join(' · ')),
        el('small', { text: formatKoreanDate(new Date(h.at)) + (h.label ? ' · ' + h.label : '') })
      ]));
    });
  }
  $('clear-history').addEventListener('click', function () {
    if (!history.length || !confirm('보낸 기록을 모두 지울까요? 미리알림 앱의 항목은 지워지지 않습니다.')) return;
    history = []; store.set('history', history); renderHistory();
  });

  // ---------- 탭 전환 ----------
  function showTab(name) {
    ['capture', 'places', 'connect'].forEach(function (t) { $('tab-' + t).hidden = t !== name; });
    document.querySelectorAll('.tabbar button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    if (name === 'capture') renderDrafts();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabbar button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  // ---------- 시작 ----------
  renderStatus();
  renderPlaces();
  renderHistory();
  renderLauncherUrl();

  var incoming = (params.get('text') || '').trim();
  if (incoming) {
    input.value = incoming;
    parseNow();
    // 주소에 남은 문장을 지워, 새로고침할 때 다시 등록되지 않게 합니다.
    try { window.history.replaceState(null, '', location.pathname); } catch (e) { /* 무시 */ }
    if (params.get('auto') === '1' && drafts.length) registerDrafts();
  } else if (settings.autoMic && SpeechRecognition) {
    startListening();
  }

  // 테스트에서 쓸 수 있도록 노출
  // 이미 열려 있는 탭에 새 문장이 # 뒤로만 들어오면 다시 읽어 들입니다.
  window.addEventListener('hashchange', function () { if (location.hash.length > 1) location.reload(); });

  window.VoiceReminder = { buildPayload: buildPayload, shortcutUrl: shortcutUrl, launcherUrl: launcherUrl, decodeConfig: decodeConfig, getDrafts: function () { return drafts; } };
})();
