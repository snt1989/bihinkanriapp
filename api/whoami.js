/**
 * /api/whoami  — ログイン中の人が「管理者」かどうかを返す（画面の操作制限に使う）
 *
 * 使い方: POST { idToken }  →  { ok: true, admin: true|false }
 * 必要な環境変数は api/reset-password.js と同じ（FIREBASE_SERVICE_ACCOUNT, ADMIN_IDS）。
 */
const admin = require("firebase-admin");

const ID_DOMAIN = "@bihinkanriapp.local";
function norm(v){ return String(v == null ? "" : v).normalize("NFKC").replace(/\s+/g, "").toLowerCase(); }

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

module.exports = async function handler(req, res){
  res.setHeader("Cache-Control", "no-store");
  if(req.method !== "POST") return res.status(405).json({ ok: false, error: "method-not-allowed" });
  var body = req.body;
  if(typeof body === "string"){ try{ body = JSON.parse(body); }catch(e){ body = null; } }
  var idToken = body && body.idToken;
  if(!idToken) return res.status(400).json({ ok: false, error: "bad-request" });
  try{ initAdmin(); }catch(e){ return res.status(500).json({ ok: false, error: "not-configured" }); }
  var caller;
  try{ caller = await admin.auth().verifyIdToken(idToken); }
  catch(e){ return res.status(401).json({ ok: false, error: "invalid-token" }); }
  var admins = String(process.env.ADMIN_IDS || "").split(",").map(norm).filter(Boolean);
  var callerId = norm(caller.email || "").replace(ID_DOMAIN, "");
  return res.status(200).json({ ok: true, admin: admins.indexOf(callerId) !== -1 });
};
