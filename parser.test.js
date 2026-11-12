// 실행: node parser.test.js
const assert = require('assert');
const P = require('./parser.js');

// 2026-11-12(목) 10:00 기준
const ref = new Date(2026, 10, 12, 10, 0, 0);
const opt = { referenceDate: ref };
const one = (t) => P.parseSingle(t, opt);
const at = (d) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].join('-');

let d;

// --- iOS 앱의 기존 테스트 6개 ---
d = one('집 도착했을 때 세탁기 돌리기');
assert.strictEqual(d.title, '세탁기 돌리기');
assert.strictEqual(d.place.name, '집');
assert.strictEqual(d.proximity, 'arriving');

d = one('학교 도착했을 때 교수님께 과제 제출하기');
assert.strictEqual(d.title, '교수님께 과제 제출하기');
assert.strictEqual(d.place.name, '학교');

d = one('집에서 출발할 때 우산 챙기기');
assert.strictEqual(d.title, '우산 챙기기');
assert.strictEqual(d.place.name, '집');
assert.strictEqual(d.proximity, 'leaving');

d = one('내일 오후 3시에 학교 도착하면 도서관 책 반납해줘');
assert.strictEqual(d.title, '도서관 책 반납하기');
assert.strictEqual(d.place.name, '학교');
assert.strictEqual(at(d.dueDate), '2026-11-13-15-0');
assert.strictEqual(d.hasSpecificTime, true);

const multi = P.parseMultiple('퇴근할 때 우유 사기 그리고 집 도착했을 때 택배 확인하기', opt);
assert.strictEqual(multi.length, 2);
assert.strictEqual(multi[0].place.name, '회사');
assert.strictEqual(multi[0].proximity, 'leaving');
assert.strictEqual(multi[0].title, '우유 사기');
assert.strictEqual(multi[1].place.name, '집');
assert.strictEqual(multi[1].title, '택배 확인하기');

d = one('강남역 도착했을 때 친구한테 전화하기');
assert.strictEqual(d.dynamicPlaceName, '강남역');
assert.strictEqual(d.place, null);
assert.strictEqual(d.title, '친구한테 전화하기');

// --- 날짜·시간 ---
d = one('내일 오후 3시에 치과 예약하기');
assert.strictEqual(at(d.dueDate), '2026-11-13-15-0');
assert.strictEqual(d.title, '치과 예약하기');

d = one('3시에 치과 가기'); // 오전·오후 생략 시 1~6시는 오후
assert.strictEqual(at(d.dueDate), '2026-11-12-15-0');

d = one('9시에 회의 준비'); // 이미 지난 시각이면 내일
assert.strictEqual(at(d.dueDate), '2026-11-13-9-0');

d = one('오늘 저녁 7시 반에 엄마한테 전화하기');
assert.strictEqual(at(d.dueDate), '2026-11-12-19-30');
assert.strictEqual(d.title, '엄마한테 전화하기');

d = one('저녁 7시 20분에 약 먹기');
assert.strictEqual(at(d.dueDate), '2026-11-12-19-20');

d = one('30분 뒤에 빨래 널기');
assert.strictEqual(at(d.dueDate), '2026-11-12-10-30');
assert.strictEqual(d.title, '빨래 널기');

d = one('두 시간 후에 약 먹기');
assert.strictEqual(at(d.dueDate), '2026-11-12-12-0');

d = one('내일 과제 제출'); // 날짜만 말하면 오전 9시
assert.strictEqual(at(d.dueDate), '2026-11-13-9-0');
assert.strictEqual(d.hasSpecificTime, false);

d = one('금요일에 보고서 내기'); // 목요일 기준 다음 금요일
assert.strictEqual(at(d.dueDate), '2026-11-13-9-0');

d = one('다음 주 월요일 오전 10시에 회의');
assert.strictEqual(at(d.dueDate), '2026-11-16-10-0');

d = one('모레 밤에 쓰레기 버리기');
assert.strictEqual(at(d.dueDate), '2026-11-14-21-0');

// --- 잘못 인식하면 안 되는 경우 ---
d = one('세 시간 동안 공부하기'); // "세 시"로 읽으면 안 됨
assert.strictEqual(d.dueDate, null);
assert.strictEqual(d.title, '세 시간 동안 공부하기');

d = one('내일 3시 반납하기'); // "반납"의 "반"을 30분으로 읽으면 안 됨
assert.strictEqual(at(d.dueDate), '2026-11-13-15-0');
assert.strictEqual(d.title, '반납하기');

d = one('내일 3시 2개 사기'); // "2"를 분으로 읽으면 안 됨
assert.strictEqual(at(d.dueDate), '2026-11-13-15-0');
assert.strictEqual(d.title, '2개 사기');

d = one('우유 사기');
assert.strictEqual(d.dueDate, null);
assert.strictEqual(d.place, null);
assert.strictEqual(d.dynamicPlaceName, null);
assert.strictEqual(d.title, '우유 사기');

// --- 우선순위, 별칭, 사용자 장소 ---
d = one('꼭 내일 은행 가기');
assert.strictEqual(d.priority, 1);
assert.strictEqual(d.title, '은행 가기');

d = one('자취방 도착하면 환기하기');
assert.strictEqual(d.place.name, '집');
assert.strictEqual(d.title, '환기하기');

d = P.parseSingle('교회 도착하면 주보 챙기기', {
  referenceDate: ref,
  places: [{ name: '교회', aliases: ['예배당'], address: '서울' }]
});
assert.strictEqual(d.place.name, '교회');
assert.strictEqual(d.title, '주보 챙기기');

d = one('마트에서 나올 때 영수증 챙기기');
assert.strictEqual(d.dynamicPlaceName, '마트');
assert.strictEqual(d.proximity, 'leaving');

console.log('모든 파서 테스트 통과');
