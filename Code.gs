/*************************************************************
 * 特定技能 定期面談 管理システム（GAS Web App）
 * ───────────────────────────────────────────────
 * ・各施設ページ : ?fid=施設ID&token=トークン（ログイン不要）
 * ・管理ページ   : パラメータなしでアクセス → Googleログインのメールを
 *                  管理者マスタと照合
 *
 * デプロイは2つ作ります（詳細は README 参照）
 *   [施設用] 実行=自分 / アクセス=全員            … 施設にこのURLを配布
 *   [管理用] 実行=自分 / アクセス=Googleアカウント … 社内のみ
 *************************************************************/

/*** ① ここだけ設定 *****************************************/
const SPREADSHEET_ID = '1nQpHBvvD5mszAHZyI2J8622GZ-rgceu8UHxuXsc47q0';
/**********************************************************/

const SHEETS = {
  admins:     '管理者マスタ',
  facilities: '施設マスタ',
  workers:    '人材マスタ',
  records:    '面談記録',
  violations: '法令違反記録',
  log:        'アクセスログ'   // 無ければ自動作成
};
const TZ = 'Asia/Tokyo';
const SOON_DAYS = 30;          // 次回面談が何日以内なら「間近」とするか

// 様式第5-5号 3.面談結果 18項目（列コード → 区分・表示名）
const ITEMS = [
  ['業務1','①業務内容','雇用契約と異なる業務に従事していないこと'],
  ['業務2','①業務内容','他の事業主の下で業務に従事していないこと'],
  ['業務3','①業務内容','安全衛生に配慮して適切に業務を行っていること'],
  ['待遇1','②待遇','雇用契約に基づき毎月適切に報酬を受け取っていること'],
  ['待遇2','②待遇','雇用契約と異なる労働時間となっていないこと'],
  ['待遇3','②待遇','休日，休暇等が適切に付与されていること（一時帰国休暇を含む）'],
  ['待遇4_住居','②待遇','適切な住居が確保されていること'],
  ['待遇5_食費居住費','②待遇','定期的に負担する食費，居住費等が合意したとおりの内容であること'],
  ['待遇6','②待遇','支援計画にのっとった支援の提供を受けていること'],
  ['保護1','③保護','暴行・脅迫・監禁等の不法行為を受けていないこと'],
  ['保護2','③保護','保証金の徴収・違約金を定める契約等がないこと'],
  ['保護3','③保護','預金通帳の管理など不当な財産管理を受けていないこと'],
  ['保護4','③保護','旅券・在留カードを自分で保管していること'],
  ['保護5','③保護','私生活上の自由を不当に制限されていないこと'],
  ['生活1','④生活','日常生活においてトラブルが発生していないこと'],
  ['生活2','④生活','健康状態に異常がないこと'],
  ['その他1','⑤その他','不法就労者が働いていないこと'],
  ['その他2','⑤その他','その他']
];

/*===========================================================
 * エントリポイント
 *==========================================================*/
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.fid) return routeFacility_(p);      // 施設ページ
    if (isAdmin_(p)) return renderAdmin_();    // 管理ページ
    return renderDenied_('管理ページの閲覧権限がありません。社内のGoogleアカウントでログインしてください。');
  } catch (err) {
    return renderDenied_('エラーが発生しました：' + err.message);
  }
}

/*===========================================================
 * 施設ページ（トークン照合）
 *==========================================================*/
function routeFacility_(p) {
  const fac = getFacilityByToken_(p.fid, p.token);
  if (!fac) { logAccess_(p.fid, 'facility', 'denied-token'); return renderDenied_('このリンクは無効です。施設のご担当者へ最新のURLをご確認ください。'); }
  if (fac.pin) {
    if (!p.pin)                         return renderPin_(p.fid, p.token, false);
    if (String(p.pin) !== fac.pin)     { logAccess_(p.fid, 'facility', 'denied-pin'); return renderPin_(p.fid, p.token, true); }
  }
  logAccess_(p.fid, 'facility', 'ok');
  const model = buildFacilityModel_(fac);
  const t = HtmlService.createTemplateFromFile('facility');
  t.data = safeJson_(model);
  return page_(t, '面談レポート｜' + fac.name);
}

/*===========================================================
 * 管理ページ
 *==========================================================*/
function renderAdmin_() {
  const model = buildAdminModel_();
  const t = HtmlService.createTemplateFromFile('admin');
  t.data = safeJson_(model);
  return page_(t, '特定技能 面談管理｜ホップ管理ページ');
}

/*===========================================================
 * 認可
 *==========================================================*/
function isAdmin_(p) {
  // (1) Googleログインのメールが管理者マスタにあるか（推奨経路）
  const email = currentEmail_();
  if (email) {
    const hit = table_(SHEETS.admins).find(r =>
      norm_(r['メールアドレス（Googleアカウント）']) === email && String(r['有効フラグ']) === '有効');
    if (hit) { logAccess_('-', 'admin', email); return true; }
  }
  // (2) 管理シークレット（任意）。スクリプトプロパティ ADMIN_SECRET と ?admin= が一致
  const secret = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET');
  if (secret && p.admin && p.admin === secret) { logAccess_('-', 'admin', 'secret'); return true; }
  return false;
}
// 書き込み系は必ずGoogleログインの管理者本人のみ（シークレットは不可）
function requireAdmin_() {
  const email = currentEmail_();
  if (email) {
    const hit = table_(SHEETS.admins).find(r =>
      norm_(r['メールアドレス（Googleアカウント）']) === email && String(r['有効フラグ']) === '有効');
    if (hit) return email;
  }
  throw new Error('権限がありません。管理用URL（Googleログイン必須）からご利用ください。');
}
function currentEmail_() {
  try { return norm_(Session.getActiveUser().getEmail() || ''); } catch (e) { return ''; }
}

/*===========================================================
 * データ取得・ビューモデル
 *==========================================================*/
function getFacilityByToken_(fid, token) {
  if (!fid || !token) return null;
  const f = table_(SHEETS.facilities).find(r =>
    String(r['施設ID']) === String(fid) && String(r['有効フラグ']) === '有効');
  if (!f) return null;
  if (String(f['アクセストークン']) !== String(token)) return null;
  return {
    id: String(f['施設ID']), name: f['施設名'], area: f['所在地'], org: f['所属機関'],
    pin: f['PIN（任意・4桁）'] === '' ? '' : String(f['PIN（任意・4桁）']),
    cycle: Number(f['面談周期(月)']) || 3
  };
}

function buildFacilityModel_(fac) {
  const workers = workerModelsForFacility_(fac);
  return {
    facility: { id: fac.id, name: fac.name, area: fac.area, org: fac.org },
    items: ITEMS.map(i => ({ code: i[0], cat: i[1], label: i[2] })),
    workers: workers,
    generatedAt: fmtDate_(new Date(), 'yyyy/MM/dd HH:mm')
  };
}

function buildAdminModel_() {
  const facs = table_(SHEETS.facilities).filter(r => String(r['有効フラグ']) === '有効');
  const list = facs.map(f => {
    const fac = {
      id: String(f['施設ID']), name: f['施設名'], area: f['所在地'],
      org: f['所属機関'], cycle: Number(f['面談周期(月)']) || 3,
      pin: f['PIN（任意・4桁）'] === '' ? '' : String(f['PIN（任意・4桁）'])
    };
    const ws = workerModelsForFacility_(fac);
    return {
      id: fac.id, name: fac.name, area: fac.area, org: fac.org,
      total: ws.length,
      warn: ws.filter(w => w.status === 'warn').length,
      bad:  ws.filter(w => w.status === 'bad').length,
      overdue: ws.filter(w => w.dueState === 'overdue').length,
      soon:    ws.filter(w => w.dueState === 'soon').length,
      none:    ws.filter(w => w.latest === null).length,
      workers: ws
    };
  });
  return {
    facilities: list,
    items: ITEMS.map(i => ({ code: i[0], cat: i[1], label: i[2] })),
    generatedAt: fmtDate_(new Date(), 'yyyy/MM/dd HH:mm')
  };
}

// 施設内の人材ごとに「最新面談＋履歴＋ステータス＋次回予定」をまとめる
function workerModelsForFacility_(fac) {
  const workers    = table_(SHEETS.workers).filter(w => String(w['施設ID']) === fac.id);
  const allRecords = table_(SHEETS.records).filter(r => String(r['施設ID']) === fac.id);
  const violations = table_(SHEETS.violations);
  const today = startOfDay_(new Date());

  return workers.map(w => {
    const pid = String(w['人材ID']);
    const recs = allRecords
      .filter(r => String(r['人材ID']) === pid)
      .map(r => recordModel_(r, violations))
      .sort((a, b) => (b._t || 0) - (a._t || 0));
    const latest = recs[0] || null;

    let nextDue = '', dueState = 'none';
    if (latest) {
      nextDue = latest.nextDue;
      if (latest._next) {
        const diff = Math.floor((latest._next - today) / 86400000);
        dueState = diff < 0 ? 'overdue' : (diff <= SOON_DAYS ? 'soon' : 'ok');
      }
    }
    return {
      id: pid, name: w['氏名（ローマ字）'], nat: w['国籍'],
      zairyu: w['在留資格'], joined: fmtDate_(w['配属日'], 'yyyy/MM/dd'),
      status: latest ? latest.status : 'none',
      latest: latest, history: recs.map(r => ({ date: r.date, status: r.status })),
      nextDue: nextDue, dueState: dueState
    };
  });
}

function recordModel_(r, violations) {
  const problems = [];
  ITEMS.forEach(it => {
    if (String(r[it[0]]) === '有') problems.push({ code: it[0], cat: it[1], label: it[2] });
  });
  const hasViolation = String(r['法令違反']) === '有';
  let violation = null;
  if (hasViolation) {
    const v = violations.find(x => String(x['記録ID']) === String(r['記録ID']));
    if (v) violation = {
      occurred: fmtDate_(v['発生年月日'], 'yyyy/MM/dd'),
      detail: v['違反事実の内容'],
      a: v['ア_本人への対応'],
      notifyDone: v['イ_責任者通知'], notifyDate: fmtDate_(v['イ_通知日'], 'yyyy/MM/dd'),
      notifyTo: v['イ_通知先'], immigGuide: v['イ_入管届出の案内'],
      reportDone: v['ウ_関係機関通報'], reportDate: fmtDate_(v['ウ_通報日'], 'yyyy/MM/dd'),
      reportOffice: v['ウ_通報先']
    };
  }
  const status = hasViolation ? 'bad' : (problems.length ? 'warn' : 'ok');
  const d = toDate_(r['面談日']);
  const nd = toDate_(r['次回面談予定日']);
  return {
    recordId: String(r['記録ID']),
    date: fmtDate_(r['面談日'], 'yyyy/MM/dd'),
    respondent: r['対応者氏名'], role: r['対応者役職'],
    problems: problems, problemNote: r['問題内容'],
    other: r['その他特筆事項'],
    madeOn: fmtDate_(r['作成年月日'], 'yyyy/MM/dd'),
    nextDue: fmtDate_(r['次回面談予定日'], 'yyyy/MM/dd'),
    status: status, violation: violation,
    _t: d ? d.getTime() : 0, _next: nd ? startOfDay_(nd) : null
  };
}

/*===========================================================
 * 書き込み（管理ページのフォームから google.script.run で呼ぶ）
 *==========================================================*/
function addWorker(form) {
  requireAdmin_();
  if (!form.fid || !form.name) throw new Error('施設と氏名は必須です。');
  const sh = sheet_(SHEETS.workers);
  const pid = nextId_(SHEETS.workers, '人材ID', 'P', 4);
  sh.appendRow([
    pid, form.fid, form.name, form.nat || '', form.zairyu || '特定技能1号',
    form.joined || '', '在籍', form.memo || ''
  ]);
  clearCache_();
  return { ok: true, id: pid };
}

function addRecord(form) {
  const email = requireAdmin_();
  if (!form.fid || !form.pid || !form.date) throw new Error('施設・人材・面談日は必須です。');
  const recId = nextId_(SHEETS.records, '記録ID', 'M', 5);

  // 18項目：既定「無」、問題ありで指定された項目だけ「有」
  const flagged = {};
  (form.problems || []).forEach(p => flagged[p.code] = p.note || '');
  const itemVals = ITEMS.map(it => flagged.hasOwnProperty(it[0]) ? '有' : '無');
  const noteText = (form.problems || [])
    .map(p => { const it = ITEMS.find(x => x[0] === p.code); return (it ? it[1] + ' ' + it[2] : p.code) + '：' + (p.note || ''); })
    .join(' / ');

  const hasViolation = !!form.violation;
  const interviewDate = parseInput_(form.date);
  const cycle = facilityCycle_(form.fid);
  const nextDue = addMonths_(interviewDate, cycle);

  const head = headers_(SHEETS.records);
  const row = head.map(h => {
    switch (h) {
      case '記録ID': return recId;
      case '人材ID': return form.pid;
      case '施設ID': return form.fid;
      case '面談日': return interviewDate;
      case '対応者氏名': return form.respondent || '';
      case '対応者役職': return form.role || '';
      case '問題内容': return noteText;
      case '法令違反': return hasViolation ? '有' : '無';
      case 'その他特筆事項': return form.other || '特になし。';
      case '作成年月日': return parseInput_(form.madeOn) || new Date();
      case '次回面談予定日': return nextDue;
      case '入力者': return form.respondent || email;
      default:
        const idx = ITEMS.findIndex(it => it[0] === h);
        return idx >= 0 ? itemVals[idx] : '';
    }
  });
  sheet_(SHEETS.records).appendRow(row);

  if (hasViolation) {
    const v = form.violation;
    const vid = nextId_(SHEETS.violations, '違反ID', 'V', 3);
    sheet_(SHEETS.violations).appendRow([
      vid, recId, form.pid, parseInput_(v.occurred) || '', v.detail || '',
      v.a || '', v.notifyDone || '', parseInput_(v.notifyDate) || '', v.notifyTo || '', v.immigGuide || '',
      v.reportDone || '', parseInput_(v.reportDate) || '', v.reportOffice || ''
    ]);
  }
  clearCache_();
  return { ok: true, id: recId };
}

// トークン再発行（漏洩時の即失効用）
function rotateToken(fid) {
  requireAdmin_();
  const sh = sheet_(SHEETS.facilities);
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  const idCol = head.indexOf('施設ID'), tkCol = head.indexOf('アクセストークン');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(fid)) {
      const t = Utilities.getUuid().replace(/-/g, '');
      sh.getRange(i + 1, tkCol + 1).setValue(t);
      clearCache_();
      return { ok: true, token: t };
    }
  }
  throw new Error('施設が見つかりません：' + fid);
}

// 管理ページが人材追加フォーム用に施設・人材一覧を取得（管理者のみ）
function getOptions() {
  requireAdmin_();
  const facs = table_(SHEETS.facilities).filter(r => String(r['有効フラグ']) === '有効')
    .map(f => ({ id: String(f['施設ID']), name: f['施設名'] }));
  const ppl = table_(SHEETS.workers).filter(w => String(w['在籍状況']) !== '帰国')
    .map(w => ({ id: String(w['人材ID']), fid: String(w['施設ID']), name: w['氏名（ローマ字）'] }));
  return { facilities: facs, workers: ppl, items: ITEMS.map(i => ({ code: i[0], cat: i[1], label: i[2] })) };
}

/*===========================================================
 * 面談票PDF生成（様式第5-5号）
 *   管理ページ：requireAdmin_ が通れば任意の記録を出力
 *   施設ページ：fid+token を検証し、自施設の記録のみ出力
 *   （施設ページは executeAs=自分 なので google.script.run は
 *     所有者権限で動くが、下の認可で自施設に限定している）
 *==========================================================*/
function makeRecordPdf(recordId, fid, token) {
  recordId = String(recordId || '');
  let isAdmin = false;
  try { requireAdmin_(); isAdmin = true; } catch (e) {}
  const rec = table_(SHEETS.records).find(r => String(r['記録ID']) === recordId);
  if (!rec) throw new Error('記録が見つかりません。');
  if (!isAdmin) {
    const facAuth = getFacilityByToken_(fid, token);
    if (!facAuth || String(rec['施設ID']) !== String(facAuth.id)) throw new Error('権限がありません。');
  }
  const worker   = table_(SHEETS.workers).find(w => String(w['人材ID']) === String(rec['人材ID'])) || {};
  const facility = table_(SHEETS.facilities).find(f => String(f['施設ID']) === String(rec['施設ID'])) || {};
  const model = recordModel_(rec, table_(SHEETS.violations));
  const html  = buildRecordHtml_(model, worker, facility);
  const pdf   = Utilities.newBlob(html, 'text/html', 'report.html').getAs('application/pdf');
  const who   = String(worker['氏名（ローマ字）'] || rec['人材ID'] || '').replace(/\s+/g, '_');
  const name  = '定期面談報告書_' + who + '_' + String(model.date).replace(/\//g, '') + '.pdf';
  logAccess_(String(rec['施設ID']), 'pdf', recordId);
  return { name: name, b64: Utilities.base64Encode(pdf.getBytes()) };
}

// 問題内容テキスト（"区分 事項：メモ / ..."）から該当事項のメモを取り出す
function extractNoteFor_(problemNote, label) {
  if (!problemNote) return '';
  const parts = String(problemNote).split(' / ');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].indexOf(label) >= 0) { const k = parts[i].indexOf('：'); return k >= 0 ? parts[i].slice(k + 1) : parts[i]; }
  }
  return '';
}

function buildRecordHtml_(r, w, f) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const catCount = {};
  ITEMS.forEach(it => { catCount[it[1]] = (catCount[it[1]] || 0) + 1; });
  const seen = {};
  let body = '';
  ITEMS.forEach(it => {
    const p = r.problems.find(x => x.code === it[0]);
    const note = p ? extractNoteFor_(r.problemNote, it[2]) : '';
    let catCell = '';
    if (!seen[it[1]]) { seen[it[1]] = true; catCell = '<td class="cat" rowspan="' + catCount[it[1]] + '">' + esc(it[1]) + '</td>'; }
    body += '<tr>' + catCell +
      '<td>' + esc(it[2]) + '</td>' +
      '<td class="yn' + (p ? ' has' : '') + '">' + (p ? '有' : '無') + '</td>' +
      '<td>' + esc(note) + '</td></tr>';
  });

  let vio = '';
  if (r.violation) {
    const v = r.violation;
    vio = '<div class="sec">４ 法令違反等への対応</div>' +
      '<table class="vio"><tr><td class="vh" colspan="2">⑥ 法令違反等の有無：有り</td></tr>' +
      '<tr><td class="k">①発生年月日</td><td>' + esc(v.occurred) + '</td></tr>' +
      '<tr><td class="k">②違反事実の内容</td><td>' + esc(v.detail) + '</td></tr>' +
      '<tr><td class="k">ア　本人への対応</td><td>' + esc(v.a) + '</td></tr>' +
      '<tr><td class="k">イ　責任者への通知</td><td>' + esc(v.notifyDone) + (v.notifyDate ? '（' + esc(v.notifyDate) + '／' + esc(v.notifyTo) + '）' : '') + '</td></tr>' +
      '<tr><td class="k">イ　入管への届出案内</td><td>' + esc(v.immigGuide) + '</td></tr>' +
      '<tr><td class="k">ウ　関係機関への通報</td><td>' + esc(v.reportDone) + (v.reportDate ? '（' + esc(v.reportDate) + '／通報先：' + esc(v.reportOffice) + '）' : '') + '</td></tr>' +
      '</table>';
  }

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page{size:A4;margin:14mm;} body{font-family:sans-serif;color:#111;font-size:11px;line-height:1.6;margin:0;}' +
    'h1{font-size:17px;text-align:center;margin:2px 0;letter-spacing:.1em;} .ref{text-align:right;font-size:10px;color:#555;}' +
    '.sec{font-size:12px;font-weight:bold;background:#1F3864;color:#fff;padding:3px 8px;margin:12px 0 4px;}' +
    'table{width:100%;border-collapse:collapse;} td,th{border:1px solid #888;padding:4px 6px;vertical-align:top;text-align:left;}' +
    '.k{background:#f0f0f0;width:24%;font-size:10px;white-space:nowrap;} table.res th{background:#f0f0f0;font-size:10px;}' +
    'table.res td{font-size:10px;} .cat{background:#fafafa;width:58px;font-weight:bold;} .yn{text-align:center;width:36px;} .yn.has{color:#b42318;font-weight:bold;}' +
    'table.vio td{border-color:#b42318;font-size:10px;} .vh{background:#fbeae8;color:#b42318;font-weight:bold;}' +
    '.foot{margin-top:10px;font-size:10px;color:#333;} .foot td{border:none;padding:2px 0;}' +
    '</style></head><body>' +
    '<div class="ref">参考様式第5-5号</div>' +
    '<h1>定期面談報告書</h1>' +
    '<div class="sec">１　面談対象者</div>' +
    '<table><tr><td class="k">氏名</td><td>' + esc(w['氏名（ローマ字）']) + '</td><td class="k">国籍</td><td>' + esc(w['国籍']) + '</td></tr>' +
    '<tr><td class="k">在留資格</td><td>' + esc(w['在留資格'] || '特定技能1号') + '</td><td class="k">面談日</td><td>' + esc(r.date) + '</td></tr>' +
    '<tr><td class="k">受入機関（施設）</td><td colspan="3">' + esc(f['施設名']) + '　' + esc(f['所在地'] || '') + '</td></tr></table>' +
    '<div class="sec">２　面談対応者</div>' +
    '<table><tr><td class="k">氏名</td><td>' + esc(r.respondent) + '</td><td class="k">役職</td><td>' + esc(r.role) + '</td></tr></table>' +
    '<div class="sec">３　面談結果</div>' +
    '<table class="res"><tr><th class="cat">区分</th><th>確認事項</th><th class="yn">問題</th><th>問題の内容</th></tr>' + body + '</table>' +
    (r.other ? '<table style="margin-top:6px;"><tr><td class="k">その他特筆事項</td><td>' + esc(r.other) + '</td></tr></table>' : '') +
    vio +
    '<table class="foot"><tr><td>作成年月日：' + esc(r.madeOn || '') + '　／　次回面談予定日：' + esc(r.nextDue || '') + '</td>' +
    '<td style="text-align:right;">入力者：' + esc(r.respondent || '') + '</td></tr></table>' +
    '</body></html>';
}

/*===========================================================
 * 補助
 *==========================================================*/
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function page_(template, title) {
  return template.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderDenied_(msg) {
  const t = HtmlService.createTemplateFromFile('denied');
  t.message = msg; t.showPin = false; t.fid = ''; t.token = ''; t.bad = false;
  return page_(t, 'アクセスできません');
}
function renderPin_(fid, token, bad) {
  const t = HtmlService.createTemplateFromFile('denied');
  t.message = ''; t.showPin = true; t.fid = fid; t.token = token; t.bad = bad;
  return page_(t, 'PINの入力');
}

function table_(name) {
  const cache = cacheGet_(name);
  if (cache) return cache;
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません：' + name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0].map(String);
  const rows = values.slice(1)
    .filter(r => r.join('') !== '')
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
  cacheSet_(name, rows);
  return rows;
}
function headers_(name) { return ss_().getSheetByName(name).getDataRange().getValues()[0].map(String); }
function sheet_(name) { const s = ss_().getSheetByName(name); if (!s) throw new Error('シートが見つかりません：' + name); return s; }
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function facilityCycle_(fid) {
  const f = table_(SHEETS.facilities).find(r => String(r['施設ID']) === String(fid));
  return f ? (Number(f['面談周期(月)']) || 3) : 3;
}

function nextId_(sheetName, col, prefix, width) {
  const rows = table_(sheetName);
  let max = 0;
  rows.forEach(r => {
    const m = String(r[col]).match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + String(max + 1).padStart(width, '0');
}

function logAccess_(fid, kind, result) {
  try {
    let sh = ss_().getSheetByName(SHEETS.log);
    if (!sh) { sh = ss_().insertSheet(SHEETS.log); sh.appendRow(['日時', '種別', '施設ID', '結果']); }
    sh.appendRow([new Date(), kind, fid, result]);
  } catch (e) { /* ログ失敗は無視 */ }
}

/* キャッシュ（同一実行内の重複読込を回避） */
let _CACHE = {};
function cacheGet_(k) { return _CACHE[k] || null; }
function cacheSet_(k, v) { _CACHE[k] = v; }
function clearCache_() { _CACHE = {}; }

/* 日付ユーティリティ */
function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === '' || v == null) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate_(v, pattern) {
  const d = toDate_(v);
  return d ? Utilities.formatDate(d, TZ, pattern) : (v == null ? '' : String(v));
}
function parseInput_(v) {        // 'yyyy-mm-dd' 等 → Date
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d;
}
function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addMonths_(d, m) { const x = new Date(d.getTime()); x.setMonth(x.getMonth() + m); return x; }

function norm_(s) { return String(s || '').trim().toLowerCase(); }
function safeJson_(o) { return JSON.stringify(o).replace(/</g, '\\u003c'); }
