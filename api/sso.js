"use strict";
/**
 * 現場管理アプリからのシングルサインオン（Vercel Serverless Function）
 *
 * 現場管理アプリが発行した「60秒だけ有効な署名付きチケット」を受け取り、
 * 借受者台帳（employees）で同じ氏名の人が「ちょうど1人」かつ社員番号（loginId）が紐づいていれば、
 * その人の Firebase アカウントでログインするためのカスタムトークンを返す。
 * 一致しない・複数いる場合は何もしない（通常のログイン画面になる）。
 *
 * 必要な環境変数（Vercel）
 *   FIREBASE_SERVICE_ACCOUNT : パスワード再設定APIと同じ（Admin SDK用）
 *   SSO_SECRET               : 現場管理アプリと同じ値（任意の長いランダム文字列）
 *
 * リクエスト: POST /api/sso  { ticket: "<現場管理アプリが発行したチケット>" }
 * 応答: { ok:true, token:"<カスタムトークン>" } / { ok:false, error:"..." }
 */
const admin = require("firebase-admin");
const crypto = require("crypto");

const ID_DOMAIN = "@bihinkanriapp.local"; // 画面側（index.html）と同じ

function norm(v){ return String(v == null ? "" : v).normalize("NFKC").replace(/\s+/g, "").toLowerCase(); }
function b64u(buf){ return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

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

// チケットを検証して氏名を返す（不正・期限切れは null）
function readTicket(ticket, secret){
  var parts = String(ticket || "").split(".");
  if(parts.length !== 2) return null;
  var want = b64u(crypto.createHmac("sha256", secret).update(parts[0]).digest());
  var x = Buffer.from(want), y = Buffer.from(parts[1]);
  if(x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  var p; try{ p = JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }catch(e){ return null; }
  if(!p || !p.n || typeof p.exp !== "number" || Date.now() > p.exp || p.exp - Date.now() > 5 * 60000) return null;
  return String(p.n);
}

module.exports = async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  if(req.method !== "POST"){ res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "POST only" }); }
  try{
    var secret = String(process.env.SSO_SECRET || "").trim();
    if(secret.length < 16) return res.status(200).json({ ok: false, error: "not-configured" });
    var body = req.body && typeof req.body === "object" ? req.body : (function(){ try{ return JSON.parse(req.body || "{}"); }catch(e){ return {}; } })();
    var name = readTicket(body.ticket, secret);
    if(!name) return res.status(200).json({ ok: false, error: "bad-ticket" });
    initAdmin();
    var key = norm(name);
    var snap = await admin.firestore().collection("employees").get();
    var hits = [];
    snap.docs.forEach(function(d){
      var e = d.data() || {};
      var full = (e.lastName || e.firstName) ? (e.lastName || "") + (e.firstName || "") : (e.name || "");
      if(norm(full) === key && e.loginId && e.active !== false) hits.push(e);
    });
    if(hits.length !== 1) return res.status(200).json({ ok: false, error: hits.length ? "ambiguous" : "no-match" });
    var user;
    try{ user = await admin.auth().getUserByEmail(norm(hits[0].loginId) + ID_DOMAIN); }
    catch(e){ return res.status(200).json({ ok: false, error: "no-account" }); }
    var token = await admin.auth().createCustomToken(user.uid);
    return res.status(200).json({ ok: true, token: token });
  }catch(e){
    var msg = String(e && e.message || e);
    return res.status(200).json({ ok: false, error: msg === "not-configured" ? "not-configured" : "server" });
  }
};
module.exports.readTicket = readTicket;
