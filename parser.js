// 한국어 음성 문장에서 할 일 제목, 날짜/시간, 위치 조건, 우선순위를 추출합니다.
// iOS 앱의 SmartKoreanParser.swift를 옮긴 것입니다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmartKoreanParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_PLACES = [
    { name: '집', aliases: ['우리집', '자취방', '본가', '숙소'], address: '', icon: '🏠' },
    { name: '학교', aliases: ['대학교', '캠퍼스', '강의실', '교실', '연구실'], address: '', icon: '🎓' },
    { name: '회사', aliases: ['직장', '사무실', '오피스'], address: '', icon: '🏢' },
    { name: '운동', aliases: ['헬스장', '체육관', '피트니스'], address: '', icon: '🏋️' }
  ];

  var WORD_CHAR = '[가-힣A-Za-z0-9]';

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 첫 번째 일치 부분을 잘라내고 { match, rest }를 돌려줍니다.
  function cut(text, pattern) {
    var m = new RegExp(pattern).exec(text);
    if (!m) return null;
    return { match: m, rest: text.slice(0, m.index) + text.slice(m.index + m[0].length) };
  }

  function parseKoreanNumber(token) {
    if (/^\d+$/.test(token)) return parseInt(token, 10);
    var table = {
      '한': 1, '하나': 1, '일': 1, '두': 2, '둘': 2, '이': 2, '세': 3, '셋': 3, '삼': 3,
      '네': 4, '넷': 4, '사': 4, '다섯': 5, '오': 5, '여섯': 6, '육': 6, '일곱': 7, '칠': 7,
      '여덟': 8, '팔': 8, '아홉': 9, '구': 9, '열': 10, '십': 10, '열한': 11, '열두': 12,
      '이십': 20, '삼십': 30, '사십': 40, '오십': 50
    };
    return table[token] || 0;
  }

  // ---- 1. 여러 할 일 분리 ----
  function splitIntoTaskSegments(text) {
    var parts = text
      .split(/\s+(?:그리고\s*또|그리고|그\s*다음에|그다음에는|또\s+하나\s*더)\s+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    return parts.length ? parts : [text];
  }

  // ---- 2. 우선순위 ----
  function extractPriority(text) {
    var remaining = text;
    var priority = 0;
    var patterns = ['^(?:꼭|무조건|중요하게|중요|필수로|급하게)\\s+', '\\s+(?:꼭|무조건|중요함|급함)$'];
    patterns.forEach(function (p) {
      var r = cut(remaining, p);
      if (r) { priority = 1; remaining = r.rest; }
    });
    return { priority: priority, rest: remaining.trim() };
  }

  // ---- 3. 위치 조건 ----
  function findSavedPlace(name, places) {
    var q = name.trim();
    for (var i = 0; i < places.length; i++) {
      if (places[i].name === q || (places[i].aliases || []).indexOf(q) >= 0) return places[i];
    }
    return null;
  }

  var STOP_WORDS = ['오늘', '내일', '모레', '글피', '아침', '점심', '저녁', '오전', '오후', '밤', '새벽', '이따', '나중'];

  function extractLocationTrigger(text, places) {
    var working = text;
    var r, i;

    // A. 관용 표현 ("퇴근할 때" → 회사 출발 등)
    var shortcutRules = [
      ['(?:퇴근할\\s*때쯤|퇴근할\\s*때|퇴근하면서|퇴근하면|퇴근길에)\\s*', '회사', 'leaving'],
      ['(?:출근할\\s*때|출근하면|출근하자마자|출근해서)\\s*', '회사', 'arriving'],
      ['(?:하교할\\s*때|하교하면|하교길에|수업\\s*끝나고\\s*학교\\s*나올\\s*때)\\s*', '학교', 'leaving'],
      ['(?:등교할\\s*때|등교하면|등교하자마자|등교해서)\\s*', '학교', 'arriving'],
      ['(?:귀가할\\s*때|귀가하면|귀가해서)\\s*', '집', 'arriving']
    ];
    for (i = 0; i < shortcutRules.length; i++) {
      r = cut(working, shortcutRules[i][0]);
      if (r) {
        var sp = findSavedPlace(shortcutRules[i][1], places);
        return { place: sp, dynamicName: sp ? null : shortcutRules[i][1], proximity: shortcutRules[i][2], rest: r.rest.trim() };
      }
    }

    var leavingSuffix = '(?:에서|에|으로부터)?\\s*(?:출발했을\\s*때|출발하면|출발할\\s*때|출발하기\\s*전에|출발시|나올\\s*때|나오면|나왔을\\s*때|나설\\s*때|나서면|떠날\\s*때|떠나면)\\s*';
    var arrivingSuffix = '(?:에|으로|로)?\\s*(?:도착했을\\s*때|도착하면|도착할\\s*때|도착해서|도착하자마자|도착시|도착\\s*후에?|가면|갈\\s*때|갔을\\s*때|들어가면|들어갈\\s*때|들를\\s*때|들르면)\\s*';
    var explicitArrivingSuffix = '(?:에|으로|로)?\\s*(?:도착했을\\s*때|도착하면|도착할\\s*때|도착해서|도착하자마자|도착시|도착\\s*후에?)\\s*';

    // 1순위: 등록된 장소
    for (i = 0; i < places.length; i++) {
      var place = places[i];
      var keywords = [place.name].concat(place.aliases || [])
        .filter(Boolean)
        .sort(function (a, b) { return b.length - a.length; })
        .map(escapeRegex)
        .join('|');
      if (!keywords) continue;
      var head = '(?<!' + WORD_CHAR + ')(?:' + keywords + ')';

      r = cut(working, head + leavingSuffix);
      if (r) return { place: place, dynamicName: null, proximity: 'leaving', rest: r.rest.trim() };

      r = cut(working, head + arrivingSuffix);
      if (r) return { place: place, dynamicName: null, proximity: 'arriving', rest: r.rest.trim() };

      r = cut(working, '^(?:' + keywords + ')에서\\s+');
      if (r) return { place: place, dynamicName: null, proximity: 'arriving', rest: r.rest.trim() };
    }

    // 2순위: 등록되지 않은 장소명 ("강남역 도착했을 때")
    var generalToken = '(' + WORD_CHAR + '{1,12}?)';
    var tries = [[leavingSuffix, 'leaving'], [explicitArrivingSuffix, 'arriving']];
    for (i = 0; i < tries.length; i++) {
      r = cut(working, generalToken + tries[i][0]);
      if (r && STOP_WORDS.indexOf(r.match[1]) < 0) {
        var saved = findSavedPlace(r.match[1], places);
        return { place: saved, dynamicName: saved ? null : r.match[1], proximity: tries[i][1], rest: r.rest.trim() };
      }
    }

    return { place: null, dynamicName: null, proximity: 'arriving', rest: working };
  }

  // ---- 4. 날짜와 시간 ----
  function weekdayOffset(dayChar, modifier, ref) {
    var map = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
    if (!(dayChar in map)) return null;
    var diff = map[dayChar] - ref.getDay();
    if (modifier === '다음주') diff += 7;
    else if (modifier === '다다음주') diff += 14;
    else if (diff <= 0) diff += 7;
    return diff;
  }

  function extractDateTime(text, ref) {
    var working = text;
    var r, i;

    // A. 상대 시간 ("30분 뒤에", "두 시간 후에")
    r = cut(working, '(?:(\\d+|한|두|세|네|다섯|여섯)\\s*시간\\s*(?:(\\d+|삼십|반)\\s*분?\\s*)?(?:뒤에?|후에?|있다가)|(\\d+|십|이십|삼십|사십|오십)\\s*분\\s*(?:뒤에?|후에?|있다가))\\s*');
    if (r) {
      var add = 0;
      if (r.match[1]) {
        add += parseKoreanNumber(r.match[1]) * 60;
        if (r.match[2]) add += r.match[2] === '반' ? 30 : parseKoreanNumber(r.match[2]);
      } else if (r.match[3]) {
        add += parseKoreanNumber(r.match[3]);
      }
      if (add > 0) {
        return { date: new Date(ref.getTime() + add * 60000), hasTime: true, rest: r.rest.trim() };
      }
    }

    // B. 날짜
    var dayOffset = null;
    var dayRules = [
      ['(?:내일\\s*모레|내일모레)(?:에)?\\s*', 2],
      ['글피(?:에)?\\s*', 3],
      ['모레(?:에)?\\s*', 2],
      ['내일(?:은|에)?\\s*', 1],
      ['오늘(?:은|에)?\\s*', 0]
    ];
    for (i = 0; i < dayRules.length; i++) {
      r = cut(working, dayRules[i][0]);
      if (r) { dayOffset = dayRules[i][1]; working = r.rest; break; }
    }
    if (dayOffset === null) {
      r = cut(working, '(?:(이번\\s*주|다음\\s*주|다다음\\s*주)\\s*)?(월|화|수|목|금|토|일)요일(?:에|날)?\\s*');
      if (r) {
        var off = weekdayOffset(r.match[2], (r.match[1] || '').replace(/\s/g, ''), ref);
        if (off !== null) { dayOffset = off; working = r.rest; }
      }
    }

    // C. 시각 ("오후 3시 반", "저녁 7시 20분")
    var hour = null;
    var minute = 0;
    r = cut(working, '(?:(오전|아침|새벽|오후|저녁|밤|낮)\\s*)?(\\d{1,2}|열한|열두|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\\s*시(?!간)(?:\\s*(?:(\\d{1,2}|이십|삼십|사십|오십|십)\\s*분|(반)(?=에|까지|쯤|\\s|$)))?(?:에|까지|쯤)?\\s*');
    if (r) {
      var mer = null;
      if (r.match[1]) mer = ['오후', '저녁', '밤', '낮'].indexOf(r.match[1]) >= 0 ? 'PM' : 'AM';
      var h = parseKoreanNumber(r.match[2]);
      if (r.match[3]) minute = parseKoreanNumber(r.match[3]);
      else if (r.match[4]) minute = 30;
      if (mer === 'PM' && h < 12) h += 12;
      else if (mer === 'AM' && h === 12) h = 0;
      else if (mer === null && h >= 1 && h <= 6) h += 12; // "3시에 치과"는 보통 오후 3시
      hour = Math.min(Math.max(h, 0), 23);
      minute = Math.min(Math.max(minute, 0), 59);
      working = r.rest;
    } else {
      var fallbacks = [
        ['(?:아침|오전)(?:에)?\\s+', 9],
        ['(?:점심|낮|정오)(?:에)?\\s+', 12],
        ['(?:저녁)(?:에)?\\s+', 19],
        ['(?:밤)(?:에)?\\s+', 21]
      ];
      for (i = 0; i < fallbacks.length; i++) {
        r = cut(working, fallbacks[i][0]);
        if (r) { hour = fallbacks[i][1]; minute = 0; working = r.rest; break; }
      }
    }

    if (dayOffset === null && hour === null) return { date: null, hasTime: false, rest: working };

    var d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + (dayOffset || 0),
      hour === null ? 9 : hour, hour === null ? 0 : minute, 0, 0);
    // 날짜를 말하지 않았는데 이미 지난 시각이면 내일로
    if (dayOffset === null && d < ref) d.setDate(d.getDate() + 1);

    return { date: d, hasTime: hour !== null, rest: working.trim() };
  }

  // ---- 5. 제목 다듬기 ----
  function cleanTaskTitle(raw, fallback) {
    var cleaned = raw.trim();
    cleaned = cleaned.replace(/^(?:그러면|그럼|그때|거기서|거기에|에서|에|고\s*나서)\s+/, '');
    cleaned = cleaned.replace(/\s*(?:미리알림에?\s*)?(?:추가해\s*줘|등록해\s*줘|적어\s*줘|넣어\s*줘|알려\s*줘|리마인드\s*해\s*줘)$/, '');
    cleaned = cleaned.replace(/해야\s*(?:해|함|겠다|지|돼|된다)$/, '하기');
    cleaned = cleaned.replace(/해\s*줘$/, '하기');
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    return cleaned || fallback;
  }

  // ---- 공개 API ----
  function parseSingle(rawInput, options) {
    options = options || {};
    var ref = options.referenceDate || new Date();
    var places = options.places || DEFAULT_PLACES;
    var original = rawInput.trim();

    var p = extractPriority(original);
    var loc = extractLocationTrigger(p.rest, places);
    var dt = extractDateTime(loc.rest, ref);

    return {
      rawText: original,
      title: cleanTaskTitle(dt.rest, original),
      dueDate: dt.date,
      hasSpecificTime: dt.hasTime,
      place: loc.place,
      dynamicPlaceName: loc.dynamicName,
      proximity: loc.proximity,
      priority: p.priority
    };
  }

  function parseMultiple(rawInput, options) {
    var trimmed = (rawInput || '').trim();
    if (!trimmed) return [];
    var segments = splitIntoTaskSegments(trimmed);
    return segments.map(function (s) { return parseSingle(s, options); });
  }

  return { parseSingle: parseSingle, parseMultiple: parseMultiple, DEFAULT_PLACES: DEFAULT_PLACES };
});
