/** ===== أدوات الجداول ===== */
function sh_(key) {
  var spec = SHEETS[key];
  var sh = SpreadsheetApp.openById(CFG.sheetId()).getSheetByName(spec.name);
  if (!sh) throw new Error('جدول مفقود: ' + spec.name + ' — شغّل setup()');
  return sh;
}

function rows_(key) {
  var sh = sh_(key), last = sh.getLastRow();
  if (last < 2) return [];
  var head = SHEETS[key].head;
  return sh.getRange(2, 1, last - 1, head.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
}

function append_(key, obj) {
  sh_(key).appendRow(SHEETS[key].head.map(function (h) {
    return obj[h] === undefined ? '' : obj[h];
  }));
}

function setCell_(key, row, field, value) {
  sh_(key).getRange(row, SHEETS[key].head.indexOf(field) + 1).setValue(value);
}

function id_(len) {
  var abc = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  var b = Utilities.getUuid().replace(/-/g, '');
  for (var i = 0; i < (len || 8); i++) s += abc[parseInt(b.substr(i * 2, 2), 16) % abc.length];
  return s;
}

function now_() { return new Date().toISOString(); }

/** ===== المواد ===== */
function subjectById_(sid) {
  var all = rows_('subjects');
  for (var i = 0; i < all.length; i++) if (String(all[i].id) === String(sid)) return all[i];
  return null;
}

function createSubject_(name, requireCodeToView) {
  if (!name || !String(name).trim()) throw new Error('اسم المادة مطلوب');
  var sid = id_(8);
  var folder = DriveApp.getFolderById(CFG.rootFolderId()).createFolder(String(name).trim() + ' — ' + sid);
  var viewCode = requireCodeToView ? id_(6) : '';
  append_('subjects', {
    id: sid, name: String(name).trim(), folderId: folder.getId(), createdTs: now_(),
    active: true, requireCodeToView: !!requireCodeToView, viewCode: viewCode
  });
  return { id: sid, name: String(name).trim(), viewCode: viewCode };
}

/** ===== الإدخالات ===== */
function feed_(sid, viewCode) {
  var subj = subjectById_(sid);
  if (!subj || subj.active === false) throw new Error('المادة غير موجودة');
  if (subj.requireCodeToView === true && String(viewCode || '') !== String(subj.viewCode)) {
    throw new Error('هذه المادة تتطلب رمز دخول');
  }
  var byId = {};
  rows_('entries').filter(function (e) { return String(e.subjectId) === String(sid); })
    .forEach(function (e) {
      (byId[e.entryId] = byId[e.entryId] || []).push({
        version: Number(e.version), type: e.type, title: e.title, body: e.body,
        fileUrl: e.fileUrl, fileName: e.fileName, authorName: e.authorName,
        ts: e.ts, deleted: e.deleted === true || e.deleted === 'TRUE'
      });
    });
  var items = Object.keys(byId).map(function (k) {
    var vs = byId[k].sort(function (a, b) { return a.version - b.version; });
    var cur = vs[vs.length - 1];
    return { entryId: k, current: cur, history: vs };
  }).filter(function (it) { return !it.current.deleted; })
    .sort(function (a, b) { return a.current.ts < b.current.ts ? 1 : -1; });

  return { subject: { id: subj.id, name: subj.name }, items: items, fetchedAt: now_() };
}

function nextVersion_(entryId) {
  var v = 0;
  rows_('entries').forEach(function (e) {
    if (String(e.entryId) === String(entryId)) v = Math.max(v, Number(e.version) || 0);
  });
  return v + 1;
}

/** يحفظ نسخة جديدة دائماً — لا استبدال ولا حذف فعلي. */
function throttle_(email) {
  var c = CacheService.getScriptCache(), k = 'w:' + email;
  var n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 60);
  if (n > 15) throw new Error('عدد كبير من العمليات خلال دقيقة — انتظر قليلاً.');
}

function saveEntry_(actor, payload) {
  throttle_(actor.email);
  var subj = subjectById_(payload.subjectId);
  if (!subj) throw new Error('المادة غير موجودة');

  var text = [payload.title, payload.body].filter(Boolean).join('\n');
  var verdict = moderate_(text);
  if (!verdict.ok) throw new Error('رُفض المحتوى: ' + verdict.reason);

  var file = null;
  if (payload.file && payload.file.bytes) file = uploadFile_(subj.folderId, payload.file);

  var entryId = payload.entryId || id_(10);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
  append_('entries', {
    entryId: entryId, subjectId: subj.id, version: nextVersion_(entryId),
    type: payload.type || 'text', title: payload.title || '', body: payload.body || '',
    fileUrl: file ? file.url : (payload.keepFileUrl || ''),
    fileName: file ? file.name : (payload.keepFileName || ''),
    authorEmail: actor.email, authorName: actor.name, ts: now_(),
    deleted: false, client: String(payload.client || '').slice(0, 200)
  });
  } finally { lock.releaseLock(); }
  return { entryId: entryId };
}

function deleteEntry_(actor, entryId, subjectId) {
  var last = null;
  rows_('entries').forEach(function (e) {
    if (String(e.entryId) === String(entryId) &&
        (!last || Number(e.version) > Number(last.version))) last = e;
  });
  if (!last) throw new Error('الإدخال غير موجود');
  append_('entries', {
    entryId: entryId, subjectId: last.subjectId, version: nextVersion_(entryId),
    type: last.type, title: last.title, body: last.body, fileUrl: last.fileUrl,
    fileName: last.fileName, authorEmail: actor.email, authorName: actor.name,
    ts: now_(), deleted: true, client: ''
  });
  return { ok: true };
}

/** ===== الملفات ===== */
var MAX_FILE_BYTES = 10 * 1024 * 1024;

function uploadFile_(folderId, f) {
  var bytes = Utilities.base64Decode(f.bytes);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('الملف أكبر من 10 ميجابايت');
  var blob = Utilities.newBlob(bytes, f.mime || 'application/octet-stream', f.name || 'file');
  var file = DriveApp.getFolderById(folderId).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://drive.google.com/file/d/' + file.getId() + '/view', name: file.getName() };
}

/** ===== فحص المحتوى عبر Gemini (من السيرفر فقط) ===== */
function moderate_(text) {
  var key = CFG.geminiKey();
  if (!key || !text || !text.trim()) return { ok: true };
  try {
    var res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
      { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({
          systemInstruction: { parts: [{ text:
            'أنت فاحص محتوى للوحة إعلانات مادة دراسية جامعية. ارفض فقط: السبّ والقذف، ' +
            'المحتوى الجنسي، التحريض على العنف، بيانات شخصية حساسة، أو ما يخالف الأنظمة السعودية. ' +
            'المحتوى الدراسي العادي مقبول دائماً. أجب بـ JSON فقط: {"ok":true} أو {"ok":false,"reason":"سبب قصير"}' }] },
          contents: [{ role: 'user', parts: [{ text: text }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });
    if (res.getResponseCode() !== 200) return { ok: true }; // لا نُعطّل النشر بسبب عطل خارجي
    var out = JSON.parse(res.getContentText());
    var t = out.candidates[0].content.parts[0].text;
    var v = JSON.parse(t);
    return v.ok === false ? { ok: false, reason: v.reason || 'مخالف' } : { ok: true };
  } catch (err) {
    return { ok: true };
  }
}
