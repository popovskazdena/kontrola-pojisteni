// Odeslání poptávky z kalkulačky na e-mail přes Cloudflare Email Routing (bez cizí služby).
import { EmailMessage } from "cloudflare:email";

const TO = "popovskazdena@gmail.com";
const FROM = "formular@zkontrolujsipojisteni.cz";
const MAX_FILE = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/poptavka") {
      if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
      try {
        return await poptavka(request, env);
      } catch (e) {
        console.error("poptavka failed", e && e.stack || e);
        return json({ ok: false, error: "server" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function poptavka(request, env) {
  const form = await request.formData();
  const jmeno = clean(form.get("jmeno"), 200);
  const kontakt = clean(form.get("kontakt"), 200);
  const souhrn = clean(form.get("souhrn"), 5000);
  if (clean(form.get("web"), 200)) return json({ ok: true }); // honeypot pro roboty
  if (!jmeno || !kontakt) return json({ ok: false, error: "missing" }, 400);

  let file = form.get("attachment");
  if (!(file && typeof file === "object" && file.size > 0)) file = null;
  if (file && file.size > MAX_FILE) return json({ ok: false, error: "too_big" }, 413);

  const body =
    "Nová poptávka z kalkulačky Kontrola pojištění nemovitosti (zkontrolujsipojisteni.cz)\n\n" +
    "Jméno: " + jmeno + "\n" +
    "Kontakt: " + kontakt + "\n\n" +
    (souhrn ? souhrn + "\n" : "") +
    (file ? "\nPřiložená smlouva: " + file.name + " (" + Math.round(file.size / 1024) + " kB)\n" : "\nSmlouva nebyla přiložena.\n");

  const boundary = "b" + crypto.randomUUID().replace(/-/g, "");
  const headers = [
    "From: " + encWord("Kalkulačka pojištění") + " <" + FROM + ">",
    "To: <" + TO + ">",
    "Subject: " + encWord("Kontrola pojištění – nový zájemce: " + jmeno),
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + crypto.randomUUID() + "@zkontrolujsipojisteni.cz>",
    "MIME-Version: 1.0",
  ];
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontakt)) headers.push("Reply-To: <" + kontakt + ">");
  headers.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');

  let raw = headers.join("\r\n") + "\r\n\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/plain; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    wrap(b64(new TextEncoder().encode(body))) + "\r\n";

  if (file) {
    const name = encWord(file.name || "smlouva");
    raw += "--" + boundary + "\r\n" +
      "Content-Type: " + (file.type || "application/octet-stream") + '; name="' + name + '"\r\n' +
      'Content-Disposition: attachment; filename="' + name + '"\r\n' +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      wrap(b64(new Uint8Array(await file.arrayBuffer()))) + "\r\n";
  }
  raw += "--" + boundary + "--\r\n";

  await env.MAIL.send(new EmailMessage(FROM, TO, raw));
  return json({ ok: true });
}

function clean(v, max) {
  return typeof v === "string" ? v.replace(/[\r\n]+/g, max > 300 ? "\n" : " ").trim().slice(0, max) : "";
}
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function wrap(s) {
  return s.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}
function encWord(s) {
  return "=?UTF-8?B?" + b64(new TextEncoder().encode(String(s).replace(/[\r\n"]+/g, " "))) + "?=";
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
