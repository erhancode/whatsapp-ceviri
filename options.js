// Ayarlar sayfası: çeviri tercihleri (waTr.settings) + AI sağlayıcıları (providers, primary).
const LANGS = [["tr", "Türkçe"], ["en", "İngilizce"], ["fr", "Fransızca"], ["ar", "Arapça"], ["fa", "Farsça"], ["ru", "Rusça"], ["de", "Almanca"], ["es", "İspanyolca"], ["it", "İtalyanca"], ["pt", "Portekizce"], ["nl", "Felemenkçe"], ["pl", "Lehçe"], ["uk", "Ukraynaca"], ["zh", "Çince"], ["ja", "Japonca"], ["ko", "Korece"], ["hi", "Hintçe"], ["ur", "Urduca"], ["az", "Azerice"], ["el", "Yunanca"], ["he", "İbranice"], ["id", "Endonezce"], ["ro", "Romence"], ["bg", "Bulgarca"], ["sv", "İsveççe"]];
const DEF = { target: "tr", engine: "auto", defaultOn: false, auto: false, enterSend: true };
const DEF_PROV = { baseUrl: "http://localhost:20128/v1", apiKey: "", model: "kc/kilo-auto/free" };
const $ = (id) => document.getElementById(id);
const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
const trimUrl = (u) => String(u || "").trim().replace(/\/+$/, "");

for (const [c, n] of LANGS) $("target").append(new Option(n, c));

function provRow(p) {
  const d = document.createElement("div");
  d.className = "prov";
  d.dataset.id = p.id || newId();
  d.innerHTML = `<div class="top"><b>Model</b><span><button type="button" class="test">Test et</button> <button type="button" class="del">Sil</button></span></div>
    <label>Adres (URL)<input type="url" class="url" placeholder="http://localhost:20128/v1"></label>
    <div class="g"><label>API anahtarı<input type="password" class="key"></label><label>Model adı<input type="text" class="model" placeholder="model adı"></label></div>
    <div class="muted st"></div>`;
  d.querySelector(".url").value = p.baseUrl || "";
  d.querySelector(".key").value = p.apiKey || "";
  d.querySelector(".model").value = p.model || "";
  d.querySelector(".del").onclick = () => { if (document.querySelectorAll(".prov").length > 1) d.remove(); };
  d.querySelector(".test").onclick = () => test(d);
  $("provs").append(d);
}
const collect = () => [...document.querySelectorAll(".prov")]
  .map((d) => ({ id: d.dataset.id, baseUrl: trimUrl(d.querySelector(".url").value), apiKey: d.querySelector(".key").value.trim(), model: d.querySelector(".model").value.trim() }))
  .filter((p) => p.baseUrl && p.model);

async function ensureAccess(url) { // yerel olmayan adresler için isteğe bağlı izin (kullanıcı tıklamasıyla)
  try {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return true;
    const o = new URL(url).origin + "/*";
    if (await chrome.permissions.contains({ origins: [o] })) return true;
    return await chrome.permissions.request({ origins: [o] });
  } catch { return false; }
}
async function test(d) {
  const st = d.querySelector(".st");
  const p = { baseUrl: trimUrl(d.querySelector(".url").value), apiKey: d.querySelector(".key").value.trim(), model: d.querySelector(".model").value.trim() };
  st.className = "muted st"; st.textContent = "Deneniyor…";
  if (!(await ensureAccess(p.baseUrl))) { st.className = "bad st"; st.textContent = "Bu adrese erişim izni verilmedi."; return; }
  try {
    const r = await fetch(p.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(p.apiKey ? { Authorization: "Bearer " + p.apiKey } : {}) },
      body: JSON.stringify({ model: p.model, messages: [{ role: "user", content: "Translate to Turkish, reply with the translation only: Hello, how are you?" }], temperature: 0 }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(r.status + " " + t.slice(0, 120));
    const j = JSON.parse(t.replace(/\s*data:\s*\[DONE\]\s*$/i, ""));
    st.className = "ok st"; st.textContent = "✓ Çalışıyor: " + String(j.choices?.[0]?.message?.content || "").slice(0, 80);
  } catch (e) { st.className = "bad st"; st.textContent = "Hata: " + e.message; }
}

async function load() {
  const { waTr, providers } = await chrome.storage.local.get(["waTr", "providers"]);
  const s = { ...DEF, ...(waTr?.settings || {}) };
  $("target").value = s.target; $("engine").value = s.engine; $("defaultOn").checked = s.defaultOn; $("auto").checked = s.auto; $("enterSend").checked = s.enterSend !== false;
  (providers?.length ? providers : [{ id: "default", ...DEF_PROV }]).forEach(provRow);
}
$("add").onclick = () => provRow({ id: newId() });
$("save").onclick = async () => {
  const provs = collect();
  if (!provs.length) { $("msg").className = "bad"; $("msg").textContent = "En az bir model (adres + model adı) gerekli."; return; }
  for (const p of provs) await ensureAccess(p.baseUrl);
  const cur = (await chrome.storage.local.get("waTr")).waTr || {};
  await chrome.storage.local.set({
    providers: provs, primary: provs[0].id,
    waTr: { ...cur, settings: { ...(cur.settings || {}), target: $("target").value, engine: $("engine").value, defaultOn: $("defaultOn").checked, auto: $("auto").checked, enterSend: $("enterSend").checked } },
  });
  $("msg").className = "ok"; $("msg").textContent = "Kaydedildi ✓";
};
load();
