"use strict";
/**
 * パスワード再設定API（Vercel Serverless Function）
 *
 * 管理者が、借受者台帳から他の人のログイン用パスワードを再設定する。
 * ブラウザ（Firebase クライアント）からは他人のパスワードを変更できないため、
 * サービスアカウントを使う Admin SDK をここ（サーバー側）で実行する。
 *
 * 必要な環境変数（Vercel の Project Settings → Environment Variables）
 *   FIREBASE_SERVICE_ACCOUNT : Firebase のサービスアカウントキー（JSON そのまま、または Base64）
 *   ADMIN_IDS                : 再設定を実行してよい社員番号（カンマ区切り。例: admin,s0001）
 *
 * リクエスト: POST /api/reset-password
 *   { idToken: "<呼び出した人の Firebase ID トークン>", loginId: "<対象の社員番号>", newPassword: "<新しいパスワード>" }
 */
const admin = require("firebase-admin");

const ID_DOMAIN = "@bihinkanriapp.local"; // 画面側（index.html）と同じ
const MIN_PW = 4;                         // 画面側と同じ最小文字数
const PW_PAD = "_bihin";                  // Firebase の6文字制限対応（画面側と同じ）

function norm(v){ return String(v == null ? "" : v).normalize("NFKC").replace(/\s+/g, "").toLowerCase(); }
function toEmail(v){ v = norm(v); return v.indexOf("@") >= 0 ? v : v + ID_DOMAIN; }
function toFirebasePassword(pw){ return pw.length < 6 ? pw + PW_PAD : pw; }

function initAdmin(){
  if(admin.apps.length) return;
  var raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw) throw new Error("not-configured");
  var text = raw.trim();
  if(text.charAt(0) !== "{") text = Buffer.from(text, "base64").toString("utf8");
  var cred;
  try{ cred = JSON.parse(text); }catch(e){ throw new Error("not-configured"); }
  admin.initializeApp({ credential: admin.credential.cert(cred) });
}

function send(res, status, error){
  res.status(status).json(error ? { ok: false, error: error } : { ok: true });
}

module.exports = async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  if(req.method !== "POST") return send(res, 405, "method-not-allowed");

  var body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = null; } }
  body = body || {};
  var idToken = body.idToken, loginId = body.loginId, newPassword = body.newPassword;
  if(!idToken || !loginId || typeof newPassword !== "string") return send(res, 400, "bad-request");
  if(newPassword.length < MIN_PW) return send(res, 400, "password-too-short");
  if(newPassword.length > 128) return send(res, 400, "password-too-long");

  try{ initAdmin(); }catch(e){ return send(res, 500, "not-configured"); }

  // 1) 呼び出した人が本人確認済み（有効なログイン）か
  var caller;
  try{ caller = await admin.auth().verifyIdToken(idToken, true); }
  catch(e){ return send(res, 401, "invalid-token"); }

  // 2) 呼び出した人が管理者か（ADMIN_IDS が未設定なら誰も許可しない）
  var admins = String(process.env.ADMIN_IDS || "").split(",").map(norm).filter(Boolean);
  var callerId = norm(caller.email || "").replace(ID_DOMAIN, "");
  if(!admins.length || admins.indexOf(callerId) === -1) return send(res, 403, "forbidden");

  // 3) 対象のアカウントを探してパスワードを更新
  var target;
  try{ target = await admin.auth().getUserByEmail(toEmail(loginId)); }
  catch(e){
    if(e && e.code === "auth/user-not-found") return send(res, 404, "user-not-found");
    return send(res, 500, "lookup-failed");
  }
  try{
    await admin.auth().updateUser(target.uid, { password: toFirebasePassword(newPassword) });
    await admin.auth().revokeRefreshTokens(target.uid); // 古いパスワードで開いていたログインを無効化
  }catch(e){
    return send(res, 500, "update-failed");
  }
  return send(res, 200);
};
