/** إعدادات النظام. لا تكتب أي سر هنا — كلها في Script Properties. */
var P = PropertiesService.getScriptProperties();

function cfg(key, required) {
  var v = P.getProperty(key);
  if (!v && required) throw new Error('إعداد ناقص: ' + key);
  return v;
}

var CFG = {
  adminEmail:   function () { return (cfg('ADMIN_EMAIL', true) || '').toLowerCase(); },
  sheetId:      function () { return cfg('SHEET_ID', true); },
  rootFolderId: function () { return cfg('ROOT_FOLDER_ID', true); },
  writeSecret:  function () { return cfg('WRITE_SECRET', true); },
  readExecUrl:  function () { return cfg('READ_EXEC_URL', true); }, // رابط نشرة القراءة (تعمل بصلاحيتي)
  geminiKey:    function () { return cfg('GEMINI_KEY', false); }    // اختياري: بدونه يُعطَّل الفحص
};

var SHEETS = {
  subjects: { name: 'Subjects', head: ['id','name','folderId','createdTs','active','requireCodeToView','viewCode'] },
  entries:  { name: 'Entries',  head: ['entryId','subjectId','version','type','title','body','fileUrl','fileName','authorEmail','authorName','ts','deleted','client'] },
  editors:  { name: 'Editors',  head: ['email','name','subjectId','status','joinedTs','termsVersion'] },
  invites:  { name: 'Invites',  head: ['code','name','subjectId','createdTs','status','usedTs','usedEmail'] }
};

var TERMS_VERSION = '1.0';

/** تهيئة كاملة بضغطة واحدة: تنشئ الشيت والمجلد والمفتاح الداخلي وتضبط الخصائص.
 *  آمنة للتكرار — لا تُنشئ شيئاً موجوداً ولا تدهس إعداداً مضبوطاً. */
function bootstrap() {
  var log = [];
  if (!P.getProperty('ADMIN_EMAIL')) {
    P.setProperty('ADMIN_EMAIL', Session.getEffectiveUser().getEmail().toLowerCase());
    log.push('المدير: ' + P.getProperty('ADMIN_EMAIL'));
  }
  if (!P.getProperty('SHEET_ID')) {
    P.setProperty('SHEET_ID', SpreadsheetApp.create('قاعدة بيانات لوحة المواد').getId());
    log.push('أُنشئ الشيت');
  }
  if (!P.getProperty('ROOT_FOLDER_ID')) {
    P.setProperty('ROOT_FOLDER_ID', DriveApp.createFolder('ملفات لوحة المواد').getId());
    log.push('أُنشئ مجلد الملفات');
  }
  if (!P.getProperty('WRITE_SECRET')) {
    P.setProperty('WRITE_SECRET', Utilities.getUuid() + Utilities.getUuid());
    log.push('وُلّد المفتاح الداخلي');
  }
  if (!P.getProperty('SITE_URL')) {
    P.setProperty('SITE_URL', 'https://a541ana-droid.github.io/madda-board/');
  }
  log.push(setup());
  var missing = [];
  if (!P.getProperty('READ_EXEC_URL')) missing.push('READ_EXEC_URL (بعد نشر نشرة القراءة)');
  if (!P.getProperty('GEMINI_KEY')) missing.push('GEMINI_KEY (اختياري)');
  if (missing.length) log.push('يتبقّى: ' + missing.join(' و'));
  var out = log.join('\n');
  Logger.log(out);
  return out;
}

/** يُشغَّل مرة واحدة بعد ضبط الخصائص: ينشئ الجداول والرؤوس. */
function setup() {
  var ss = SpreadsheetApp.openById(CFG.sheetId());
  Object.keys(SHEETS).forEach(function (k) {
    var spec = SHEETS[k];
    var sh = ss.getSheetByName(spec.name) || ss.insertSheet(spec.name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, spec.head.length).setValues([spec.head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  DriveApp.getFolderById(CFG.rootFolderId()); // تحقق مبكر من الصلاحية
  return 'تم التهيئة';
}
