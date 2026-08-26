#!/bin/bash
# رفع كود الخادم إلى مشروع Apps Script بأمر واحد.
# قبل أول استخدام: انسخ .clasp.json.example إلى .clasp.json وضع فيه معرّف المشروع،
# ثم شغّل:  npx @google/clasp login
set -e
[ -f .clasp.json ] || { echo "ينقص .clasp.json — انسخه من .clasp.json.example"; exit 1; }
npx --yes @google/clasp push --force
echo "تم الرفع. لا تنسَ إعادة نشر النشرتين من Deploy → Manage deployments."
