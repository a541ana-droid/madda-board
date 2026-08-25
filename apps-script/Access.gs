/** ===== الهوية والصلاحيات (تعمل داخل نشرة اللوحة) ===== */
function me_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('تعذّر التعرف على حسابك. افتح الرابط بحساب Google.');
  return email;
}

/** ===== المحررون والدعوات (تعمل داخل نشرة القراءة/الكتابة) ===== */
function editorByEmail_(email) {
  var e = String(email).toLowerCase(), found = null;
  rows_('editors').forEach(function (r) {
    if (String(r.email).toLowerCase() === e && r.status === 'active') found = r;
  });
  return found;
}

function whoIs_(email) {
  var e = String(email).toLowerCase();
  if (e === CFG.adminEmail()) return { email: e, name: 'المدير', role: 'admin' };
  var ed = editorByEmail_(e);
  if (ed) return { email: e, name: ed.name, role: 'editor', subjectId: ed.subjectId };
  return { email: e, name: '', role: 'guest' };
}

/** استهلاك رمز دعوة: يربط البريد المُتحقَّق منه بالاسم الذي أسنده المدير. */
function redeemInvite_(email, code) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var e = String(email).toLowerCase(), c = String(code || '').trim();
    var inv = null;
    rows_('invites').forEach(function (r) { if (String(r.code) === c) inv = r; });
    if (!inv) throw new Error('رمز غير صحيح');
    if (inv.status !== 'open') throw new Error('هذا الرمز مُستهلك أو معطّل');
    if (editorByEmail_(e)) throw new Error('حسابك مفعّل مسبقاً');

    setCell_('invites', inv._row, 'status', 'used');
    setCell_('invites', inv._row, 'usedTs', now_());
    setCell_('invites', inv._row, 'usedEmail', e);
    append_('editors', {
      email: e, name: inv.name, subjectId: inv.subjectId || '*',
      status: 'active', joinedTs: now_(), termsVersion: TERMS_VERSION
    });
    return { name: inv.name, subjectId: inv.subjectId || '*' };
  } finally {
    lock.releaseLock();
  }
}

function createInvite_(name, subjectId) {
  if (!name || !String(name).trim()) throw new Error('اكتب اسم الشخص الذي ستسلّمه الرمز');
  var code = id_(5) + '-' + id_(5) + '-' + id_(5);
  append_('invites', {
    code: code, name: String(name).trim(), subjectId: subjectId || '*',
    createdTs: now_(), status: 'open', usedTs: '', usedEmail: ''
  });
  return { code: code, name: String(name).trim() };
}

function revokeInvite_(code) {
  var hit = null;
  rows_('invites').forEach(function (r) { if (String(r.code) === String(code)) hit = r; });
  if (!hit) throw new Error('رمز غير موجود');
  if (hit.status === 'open') setCell_('invites', hit._row, 'status', 'revoked');
  return { ok: true };
}

function suspendEditor_(email) {
  var hit = null;
  rows_('editors').forEach(function (r) {
    if (String(r.email).toLowerCase() === String(email).toLowerCase()) hit = r;
  });
  if (!hit) throw new Error('محرر غير موجود');
  setCell_('editors', hit._row, 'status', 'suspended');
  return { ok: true };
}
