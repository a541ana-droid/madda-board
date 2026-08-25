/** ===================== نقطة الدخول =====================
 *  نشرة (أ) القراءة العامة: تعمل بصلاحيتي، متاحة لأي زائر — GET فقط للقراءة،
 *      وPOST داخلي محمي بمفتاح لا يظهر في المتصفح إطلاقاً.
 *  نشرة (ب) اللوحة: تعمل بصلاحية الداخل — تقرأ بريده من Google وتمرّر الكتابة للأولى.
 */

function json_(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api === 'feed') {
    try {
      return json_({ ok: true, data: feed_(p.m, p.c) });
    } catch (err) {
      return json_({ ok: false, error: String(err.message || err) });
    }
  }
  // لا api → هذه نشرة اللوحة
  return HtmlService.createTemplateFromFile('Panel').evaluate()
    .setTitle('لوحة المادة')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** نقطة الكتابة الداخلية — لا يصلها أحد بلا المفتاح. */
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.secret !== CFG.writeSecret()) throw new Error('غير مصرّح');
    return json_({ ok: true, data: dispatch_(String(req.actorEmail || '').toLowerCase(), req.action, req.payload || {}) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function dispatch_(email, action, pl) {
  var who = whoIs_(email);
  var isAdmin = who.role === 'admin';
  var isEditor = who.role === 'editor' || isAdmin;

  switch (action) {
    case 'whoami':
      return who;

    case 'redeem':
      return redeemInvite_(email, pl.code);

    case 'feed':
      return feed_(pl.subjectId, pl.viewCode);

    case 'subjects': {
      var all = rows_('subjects').filter(function (s) { return s.active !== false; })
        .map(function (s) { return { id: s.id, name: s.name, requireCodeToView: s.requireCodeToView === true, viewCode: isAdmin ? s.viewCode : '' }; });
      if (isAdmin) return all;
      if (!isEditor) throw new Error('غير مصرّح');
      return who.subjectId === '*' ? all : all.filter(function (s) { return s.id === who.subjectId; });
    }

    case 'saveEntry':
      if (!isEditor) throw new Error('غير مصرّح');
      guardSubject_(who, pl.subjectId);
      return saveEntry_(who, pl);

    case 'deleteEntry':
      if (!isEditor) throw new Error('غير مصرّح');
      guardSubject_(who, pl.subjectId);
      return deleteEntry_(who, pl.entryId, pl.subjectId);

    case 'createSubject':
      if (!isAdmin) throw new Error('للمدير فقط');
      return createSubject_(pl.name, pl.requireCodeToView);

    case 'createInvite':
      if (!isAdmin) throw new Error('للمدير فقط');
      return createInvite_(pl.name, pl.subjectId);

    case 'revokeInvite':
      if (!isAdmin) throw new Error('للمدير فقط');
      return revokeInvite_(pl.code);

    case 'suspendEditor':
      if (!isAdmin) throw new Error('للمدير فقط');
      return suspendEditor_(pl.email);

    case 'adminData':
      if (!isAdmin) throw new Error('للمدير فقط');
      return {
        subjects: rows_('subjects').map(strip_),
        editors:  rows_('editors').map(strip_),
        invites:  rows_('invites').map(strip_)
      };

    case 'ask':
      if (!isAdmin) throw new Error('للمدير فقط');
      return { answer: ask_(pl.question) };

    default:
      throw new Error('إجراء غير معروف');
  }
}

function guardSubject_(who, subjectId) {
  if (who.role === 'admin') return;
  if (who.subjectId && who.subjectId !== '*' && who.subjectId !== subjectId) {
    throw new Error('لا تملك صلاحية على هذه المادة');
  }
}

function strip_(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; }

/** مساعد Gemini للمدير: يجيب من واقع البيانات لا من تخمينه. */
function ask_(question) {
  var key = CFG.geminiKey();
  if (!key) return 'مفتاح Gemini غير مضبوط.';
  var subs = rows_('subjects').filter(function (s) { return s.active !== false; });
  var ctx = subs.map(function (s) {
    var f = feed_(s.id, s.viewCode);
    return '## ' + s.name + '\n' + f.items.slice(0, 15).map(function (i) {
      return '- [' + i.current.type + '] ' + i.current.title + ': ' +
        String(i.current.body || '').slice(0, 200) + ' (' + i.current.authorName + ' — ' + i.current.ts + ')';
    }).join('\n');
  }).join('\n\n');

  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
    { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text:
          'أنت مساعد إداري للوحة إعلانات مواد دراسية. أجب بالعربية باختصار ودقة، ' +
          'واعتمد حصراً على البيانات المرفقة. إن لم تكن الإجابة فيها فقل ذلك صراحة. ' +
          'التاريخ الآن: ' + now_() }] },
        contents: [{ role: 'user', parts: [{ text: 'البيانات:\n' + ctx + '\n\nالسؤال: ' + question }] }],
        generationConfig: { temperature: 0.2 }
      })
    });
  if (res.getResponseCode() !== 200) return 'تعذّر الوصول إلى Gemini.';
  return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
}

/** ===== تُستدعى من اللوحة (نشرة ب) — تحسب الهوية هنا ولا تثق بالمتصفح ===== */
function rpc(action, payload) {
  var email = me_();
  var res = UrlFetchApp.fetch(CFG.readExecUrl(), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ secret: CFG.writeSecret(), actorEmail: email, action: action, payload: payload || {} })
  });
  var out = JSON.parse(res.getContentText());
  if (!out.ok) throw new Error(out.error);
  return out.data;
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
