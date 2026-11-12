// WhatsApp Web çeviri katmanı (içerik betiği; yalnızca web.whatsapp.com).
//  • Gelen yabancı mesajların yanında "Çevir" düğmesi (isteğe bağlı otomatik çeviri); yalnızca o mesaj çevrilir, sayfa değil.
//  • Giden mesaj: Türkçe yaz → Enter/Gönder önizleme açar → çeviri düzenlenip karşıya o dille gider.
//  • Motor: 9router/AI sağlayıcıları (arka plan), erişilemezse Chrome dahili çeviri (Translator API).
// Ayarlar: chrome.storage.local "waTr" = { settings:{target,engine,defaultOn,auto}, chats:{[sohbet]:{on,auto,outOn,out,detected}} }
(() => {
  if (window.__uyWaTr) return;
  window.__uyWaTr = true;

  const LANGS = [["tr", "Türkçe"], ["en", "İngilizce"], ["fr", "Fransızca"], ["ar", "Arapça"], ["fa", "Farsça"], ["ru", "Rusça"], ["de", "Almanca"], ["es", "İspanyolca"], ["it", "İtalyanca"], ["pt", "Portekizce"], ["nl", "Felemenkçe"], ["pl", "Lehçe"], ["uk", "Ukraynaca"], ["zh", "Çince"], ["ja", "Japonca"], ["ko", "Korece"], ["hi", "Hintçe"], ["ur", "Urduca"], ["az", "Azerice"], ["el", "Yunanca"], ["he", "İbranice"], ["id", "Endonezce"], ["ro", "Romence"], ["bg", "Bulgarca"], ["sv", "İsveççe"]];
  const LN = Object.fromEntries(LANGS);
  const langName = (c) => LN[String(c || "").toLowerCase().slice(0, 2)] || c || "?";
  const DEF = { target: "tr", engine: "auto", defaultOn: false, auto: false, enterSend: true };
  let cfg = { settings: { ...DEF }, chats: {} };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  async function waitFor(fn, ms) { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(80); } }
  const sendMsg = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? { ok: false, error: "uzantı yenilenmiş olabilir: sayfayı F5 ile yenile (" + chrome.runtime.lastError.message + ")" } : r)); }
    catch (e) { res({ ok: false, error: "uzantı bağlantısı koptu: sayfayı F5 ile yenile" }); }
  });

  // ---------- Ayarlar ----------
  async function loadCfg() {
    try {
      const { waTr } = await chrome.storage.local.get("waTr");
      cfg = { settings: { ...DEF, ...(waTr?.settings || {}) }, chats: waTr?.chats || {} };
    } catch {}
  }
  let saveT = 0;
  function saveCfg() { clearTimeout(saveT); saveT = setTimeout(() => { try { chrome.storage.local.set({ waTr: cfg }); } catch {} }, 200); }
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local" || !ch.waTr) return;
      const v = ch.waTr.newValue || {};
      cfg = { settings: { ...DEF, ...(v.settings || {}) }, chats: v.chats || cfg.chats };
      schedule(); refreshBar();
    });
  } catch {}

  function chatKey() {
    const h = $("#main header");
    const t = h && ($("span[title]", h) || $("[title]", h));
    return ((t && (t.getAttribute("title") || t.textContent)) || "").trim() || "?";
  }
  const chatGet = (k) => cfg.chats[k || chatKey()] || {};
  // k verilmezse o anki sohbet; çeviri sürerken sohbet değişebileceği için çağıran taraf anahtarı önceden alıp geçmeli.
  function chatSet(patch, k) { k = k || chatKey(); cfg.chats[k] = { ...chatGet(k), ...patch }; saveCfg(); }
  const isOn = () => chatGet().on ?? cfg.settings.defaultOn;
  const isAuto = () => chatGet().auto ?? cfg.settings.auto;
  const outOn = () => chatGet().outOn ?? true;
  const outLang = () => chatGet().out || "auto";

  // ---------- Metin yardımcıları ----------
  function textOf(root) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.classList && (n.classList.contains("uyt-wrap") || n.classList.contains("uyt-tr"))) return;
        if (n.tagName === "IMG") out += n.alt || "";
        else if (n.tagName === "BR") out += "\n";
        else for (const c of n.childNodes) walk(c);
      }
    };
    walk(root);
    return out.trim();
  }
  function worth(t) { return t.length >= 2 && /\p{L}/u.test(t) && !/^https?:\/\/\S+$/.test(t); }
  // Hedef Türkçe iken bariz Türkçe metne düğme koyma (yanlış pozitif zararsız: çeviri aynı dönerse düğme gizlenir)
  function looksTarget(t) {
    if (cfg.settings.target !== "tr") return false;
    if (/[Ѐ-ӿ؀-ۿ֐-׿一-鿿぀-ヿ가-힯ऀ-ॿ]/.test(t)) return false;
    if (/[ğĞşŞıİ]/.test(t)) return true;
    return (t.toLowerCase().match(/\b(ve|bir|bu|ben|sen|için|ama|değil|mi|mı|mu|çok|evet|hayır|merhaba|nasılsın|tamam|teşekkürler|selam|var|yok|bugün|yarın|abi|kardeşim)\b/g) || []).length >= 2;
  }

  // ---------- Çeviri motoru ----------
  const cache = new Map();
  let active = 0;
  const waiters = [];
  async function slot() { if (active >= 2) await new Promise((r) => waiters.push(r)); active++; }
  function release() { active--; waiters.shift()?.(); }

  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
  const AI_TIMEOUT = 60000; // AI sağlayıcıları 2×30 sn deneyebilir; yine de düğme sonsuza kadar beklemesin
  const trCache = new Map();
  let detP = null;
  async function chromeTranslator(src, tgt, gesture) {
    if (typeof Translator === "undefined") throw new Error("Chrome dahili çeviri bu sürümde yok");
    const k = src + ">" + tgt;
    if (trCache.has(k)) return trCache.get(k);
    const av = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    if (av === "unavailable") throw new Error(`Chrome dahili çeviri ${src}→${tgt} çiftini desteklemiyor`);
    if (av !== "available" && !gesture) throw new Error("Chrome dil modeli henüz inmedi; düğmeye tıklayarak başlat");
    const t = await Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    trCache.set(k, t);
    return t;
  }
  async function detectLang(text) {
    if (typeof LanguageDetector === "undefined") throw new Error("Chrome dil algılama bu sürümde yok");
    detP = detP || LanguageDetector.create();
    const r = await (await detP).detect(text);
    const c = r[0]?.detectedLanguage;
    if (!c || c === "und") throw new Error("dil algılanamadı");
    return c.toLowerCase().slice(0, 2);
  }

  function translateIn(text, gesture) {
    const target = cfg.settings.target, key = target + "|" + text;
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      await slot();
      try {
        const eng = cfg.settings.engine, errs = [];
        let r = null;
        if (eng !== "chrome") {
          try {
            const x = await withTimeout(sendMsg({ type: "uy-translate", req: { mode: "in", text, target } }), AI_TIMEOUT, "AI yanıt vermedi (60 sn zaman aşımı)");
            if (x && x.ok) r = { text: x.text, src: x.lang, engine: "AI" }; else errs.push((x && x.error) || "AI yanıt vermedi");
          } catch (e) { errs.push(e.message); }
        }
        if (!r && eng !== "router") {
          try {
            r = await withTimeout((async () => {
              const src = await detectLang(text);
              if (src === target) return { text, src, engine: "Chrome" };
              return { text: await (await chromeTranslator(src, target, gesture)).translate(text), src, engine: "Chrome" };
            })(), gesture ? 180000 : 25000, "Chrome dahili çeviri yanıt vermedi (dil modeli inmemiş olabilir)");
          } catch (e) { errs.push(e.message); }
        }
        if (!r) throw new Error(errs.join(" · "));
        r.same = (r.src && r.src.slice(0, 2) === target) || norm(r.text) === norm(text);
        return r;
      } finally { release(); }
    })();
    cache.set(key, p);
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    p.catch(() => cache.delete(key));
    return p;
  }

  async function translateOut(text, lang, context, gesture) {
    const eng = cfg.settings.engine, errs = [];
    if (eng !== "chrome") {
      try {
        const x = await withTimeout(sendMsg({ type: "uy-translate", req: { mode: "out", text, lang, context } }), AI_TIMEOUT, "AI yanıt vermedi (60 sn zaman aşımı)");
        if (x && x.ok) return { text: x.text, lang: x.lang || (lang !== "auto" ? lang : ""), engine: "AI" };
        errs.push((x && x.error) || "AI yanıt vermedi");
      } catch (e) { errs.push(e.message); }
    }
    if (eng !== "router") {
      try {
        let L = lang;
        if (L === "auto") L = chatGet().detected || (context[0] ? await detectLang(context[context.length - 1]) : "");
        if (!L) throw new Error("karşı tarafın dili bilinmiyor; giden dili seç");
        return await withTimeout((async () => {
          const t = await chromeTranslator(cfg.settings.target, L, gesture);
          return { text: await t.translate(text), lang: L, engine: "Chrome" };
        })(), gesture ? 180000 : 25000, "Chrome dahili çeviri yanıt vermedi (dil modeli inmemiş olabilir)");
      } catch (e) { errs.push(e.message); }
    }
    throw new Error(errs.join(" · "));
  }

  // ---------- Gelen mesajlar ----------
  // Mesaj metinleri: [balon, metin öğesi]. WhatsApp'ın sınıf adları değişse de .selectable-text / data-id / message-in|out kalıcıdır.
  function messageTexts() {
    const out = [], seenB = new Set();
    for (const te of document.querySelectorAll("#main .selectable-text")) {
      if (te.closest(".uyt-wrap,.uyt-pop,header,footer")) continue;
      if (te.parentElement && te.parentElement.closest(".selectable-text")) continue; // iç içe ise dıştakini al
      if (te.closest('[class*="quoted"]')) continue; // alıntılanan mesaj önizlemesi
      const b = te.closest("[data-id]") || te.closest(".message-in,.message-out") || te.closest('[role="row"]');
      if (!b || seenB.has(b)) continue;
      seenB.add(b);
      out.push([b, te]);
    }
    return out;
  }
  function isIncoming(b) {
    const id = b.getAttribute("data-id") || "";
    if (/^(true|false)_/.test(id)) return id.startsWith("false_");
    if (b.classList.contains("message-out") || b.closest(".message-out") || b.querySelector(".message-out")) return false;
    return true;
  }
  function recentIncoming(n = 3) {
    return messageTexts().filter(([b]) => isIncoming(b)).map(([, te]) => textOf(te)).filter((t) => worth(t) && !looksTarget(t)).slice(-n);
  }

  function renderRow(row) {
    const st = row.__uyt;
    if (!st || !st.wrap) return;
    const { btn, box } = st;
    btn.style.display = st.same ? "none" : "";
    box.style.display = st.res && !st.same && st.show ? "" : "none";
    btn.textContent = st.busy ? "⏳ Çevriliyor…" : st.err ? "↻ Tekrar dene" : st.res ? (st.show ? "🌐 Gizle" : "🌐 Çeviriyi göster") : "🌐 Çevir";
    if (st.err) { box.style.display = ""; box.textContent = "⚠ " + st.err; box.classList.add("uyt-err"); }
    else if (st.res && !st.same) {
      box.classList.remove("uyt-err");
      box.textContent = "";
      const t = el("div", "uyt-text", st.res.text);
      t.dir = "auto";
      box.append(t, el("div", "uyt-meta", `${langName(st.res.src)} → ${langName(cfg.settings.target)} · ${st.res.engine}`));
    }
  }
  async function translateRow(row, gesture) {
    const st = row.__uyt;
    if (!st || st.busy) return;
    const k = chatKey(); // çeviri bitmeden sohbet değişebilir: algılanan dil bu sohbete yazılmalı
    st.busy = true; st.err = ""; renderRow(row);
    try {
      st.res = await translateIn(st.text, gesture);
      st.same = !!st.res.same; st.show = true;
      if (st.res.src && !st.same) { const d = st.res.src.slice(0, 2); if (chatGet(k).detected !== d) chatSet({ detected: d }, k); }
    }
    catch (e) { st.err = e.message; st.fails = (st.fails || 0) + 1; }
    st.started = false; // başarısızsa sonraki taramada yeniden denenebilsin (st.fails sınırı scan'de)
    st.busy = false;
    renderRow(row);
  }

  function processRow(row, te) {
    const bx = te.closest("[data-pre-plain-text]");
    const text = textOf(te);
    let st = row.__uyt;
    if (st && st.text !== text) { st.wrap?.remove(); st = row.__uyt = null; }
    if (!worth(text) || looksTarget(text)) { st?.wrap?.remove(); row.__uyt = null; return null; }
    if (!st || !st.wrap || !st.wrap.isConnected) {
      st = row.__uyt = { ...(st || {}), text };
      st.wrap = el("div", "uyt-wrap");
      st.btn = el("button", "uyt-btn", "🌐 Çevir");
      st.btn.type = "button";
      st.box = el("div", "uyt-tr");
      st.box.style.display = "none";
      st.btn.onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        if (st.res && !st.err) { st.show = !st.show; renderRow(row); } else translateRow(row, true);
      };
      st.wrap.append(st.btn, st.box);
      (bx || te.parentElement).appendChild(st.wrap);
      renderRow(row);
    }
    return st;
  }

  // ---------- Yazı kutusu ----------
  const composer = () => $('#main footer div[contenteditable="true"]') || $('footer div[contenteditable="true"]');
  const composerText = (c) => (c ? c.innerText : "").replace(/[​\r]/g, "").trim();
  const findSend = () => { const i = $('#main footer [data-icon="send"]'); return i && i.closest('button,[role="button"]'); };

  const same = (c, text) => composerText(c).replace(/\s+/g, "") === text.replace(/\s+/g, "");
  function selectAllIn(c) {
    c.focus();
    const sel = getSelection(), r = document.createRange();
    r.selectNodeContents(c);
    sel.removeAllRanges(); sel.addRange(r);
  }
  // Yazı kutusunu (Lexical benzeri editör) temizleyip metni yerleştir. Editör seçimi asenkron işler: adımlar arası bekle,
  // her adımı doğrula; DOM yolu olmazsa gerçek (trusted) girdiyle (arka plan, CDP) dene. Asla eski metne ekleme yapma.
  async function setComposer(c, text) {
    const clear = async () => {
      for (let i = 0; i < 3 && composerText(c); i++) {
        selectAllIn(c); await sleep(80);
        document.execCommand("delete", false, null); await sleep(120);
      }
      return !composerText(c);
    };
    if (await clear()) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i) { document.execCommand("insertLineBreak", false, null); await sleep(40); }
        if (lines[i]) { document.execCommand("insertText", false, lines[i]); await sleep(60); }
      }
      await sleep(150);
      if (same(c, text)) return true;
      if (!(await clear())) { /* temizlenemedi → aşağıda gerçek girdi */ }
      else {
        try { // yapıştırma olayı
          c.focus();
          const dt = new DataTransfer(); dt.setData("text/plain", text);
          c.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch {}
        await sleep(200);
        if (same(c, text)) return true;
        await clear();
      }
    }
    // gerçek klavye/yazı girdisi (Ctrl+A, Backspace, insertText)
    c.focus();
    const r = await withTimeout(sendMsg({ type: "uy-input", text }), 20000, "gerçek girdi yanıt vermedi").catch(() => null);
    await sleep(250);
    return !!(r && r.ok) && same(c, text);
  }

  let bypass = false;
  async function sendNow(text) {
    const c = composer();
    if (!c) throw new Error("yazı kutusu bulunamadı");
    bypass = true;
    try {
      if (!(await setComposer(c, text))) throw new Error("metin yazı kutusuna yerleştirilemedi (yazı kutusunu temizleyip elle yapıştırmayı dene)");
      const btn = await waitFor(findSend, 1500);
      if (btn) btn.click(); else { c.focus(); await sendMsg({ type: "uy-enter" }); }
      let ok = await waitFor(() => composerText(c) === "", 2500);
      if (!ok) { c.focus(); await sendMsg({ type: "uy-enter" }); ok = await waitFor(() => composerText(c) === "", 2500); }
      return !!ok;
    } finally { bypass = false; }
  }

  // ---------- Önizleme penceresi (giden) ----------
  let pop = null;
  function closePop() { pop?.root.remove(); pop = null; }
  function placePop() {
    if (!pop) return;
    const f = $("#main footer"), m = $("#main");
    if (!f || !m) return;
    const fr = f.getBoundingClientRect(), mr = m.getBoundingClientRect();
    Object.assign(pop.root.style, { left: mr.left + 16 + "px", width: Math.max(260, mr.width - 32) + "px", bottom: window.innerHeight - fr.top + 8 + "px" });
  }
  function openPreview(orig, gesture = true) {
    closePop();
    const root = el("div", "uyt-pop");
    const head = el("div", "uyt-pop-h");
    head.append(el("b", null, "🌐 Karşıya gidecek mesaj"));
    const sel = el("select", "uyt-sel");
    sel.append(new Option("Dil: otomatik", "auto"));
    for (const [c, n] of LANGS) sel.append(new Option(n, c));
    sel.value = outLang();
    head.append(sel);
    const info = el("div", "uyt-meta");
    const ta = el("textarea", "uyt-ta");
    ta.dir = "auto"; ta.rows = 3; ta.disabled = true; ta.placeholder = "Çevriliyor…";
    const o = el("div", "uyt-orig", "Orijinal: " + orig);
    const row = el("div", "uyt-pop-b");
    const bSend = el("button", "uyt-go", "Gönder ↵");
    const bRaw = el("button", "uyt-ghost", "Orijinali gönder");
    const bCancel = el("button", "uyt-ghost", "İptal (Esc)");
    for (const b of [bSend, bRaw, bCancel]) b.type = "button";
    row.append(bSend, bRaw, bCancel);
    root.append(head, ta, info, o, row);
    document.body.appendChild(root);
    pop = { root, ta };
    placePop();
    let seq = 0, translated = "";

    const run = async (lang) => {
      const my = ++seq;
      ta.disabled = true; ta.value = ""; ta.placeholder = "Çevriliyor…"; info.textContent = ""; info.classList.remove("uyt-err"); bSend.disabled = true;
      try {
        const det = chatGet().detected;
        const eff = lang === "auto" && det && det !== cfg.settings.target ? det : lang; // bu sohbette gelen mesajlardan öğrenilen dil
        const r = await translateOut(orig, eff, recentIncoming(3), gesture);
        if (my !== seq || !pop) return;
        translated = r.text; ta.value = r.text; ta.disabled = false; bSend.disabled = false;
        if (r.lang && lang === "auto") { chatSet({ detected: r.lang.slice(0, 2) }); }
        info.textContent = `${langName(cfg.settings.target)} → ${langName(r.lang || eff)}${lang === "auto" ? " (otomatik)" : ""} · ${r.engine} · gönderilmeden önce düzenleyebilirsin`;
        if (norm(r.text) === norm(orig) || (norm(orig).split(" ").length >= 3 && norm(orig).split(" ").filter((w) => norm(r.text).split(" ").includes(w)).length / norm(orig).split(" ").length >= 0.7)) {
          info.classList.add("uyt-err");
          info.textContent = `⚠ Çeviri orijinale çok benziyor (çevrilmemiş olabilir). Dil doğru mu? Sağ üstten "${langName(r.lang || eff)}" yerine doğru dili seç ya da metni düzenle. ` + info.textContent;
        }
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      } catch (e) {
        if (my !== seq || !pop) return;
        ta.placeholder = "Çeviri yapılamadı"; info.classList.add("uyt-err"); info.textContent = "⚠ " + e.message + " — dili değiştirip yeniden dene ya da orijinali gönder.";
      }
    };
    const doSend = async (text) => {
      if (!text.trim()) return;
      bSend.disabled = bRaw.disabled = true; info.classList.remove("uyt-err"); info.textContent = "Gönderiliyor…";
      try {
        const ok = await sendNow(text);
        if (ok) closePop();
        else { info.classList.add("uyt-err"); info.textContent = "⚠ Gönderildi mi emin olunamadı; yazı kutusunu kontrol et (metin kutuya yerleştirildi, gerekirse Enter'a bas)."; bSend.disabled = bRaw.disabled = false; }
      } catch (e) { info.classList.add("uyt-err"); info.textContent = "⚠ " + e.message; bSend.disabled = bRaw.disabled = false; }
    };
    sel.onchange = () => { chatSet({ out: sel.value }); run(sel.value); };
    bSend.onclick = () => doSend(ta.value);
    bRaw.onclick = () => doSend(orig);
    bCancel.onclick = () => { closePop(); composer()?.focus(); };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (!bSend.disabled) doSend(ta.value); }
      else if (e.key === "Escape") { e.stopPropagation(); bCancel.onclick(); }
    }, true);
    run(outLang());
  }

  const outActive = () => !!$("#main") && isOn() && outOn();
  document.addEventListener("keydown", (e) => {
    if (bypass || !outActive() || e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.isComposing) return;
    // WhatsApp'ta "Enter = yeni satır" seçiliyse kullanıcı Ctrl+Enter ile gönderir; biz de aynı tuşu yakalarız.
    const enterSends = cfg.settings.enterSend !== false;
    if (e.ctrlKey !== !enterSends) return;
    const c = composer();
    if (!c || !c.contains(e.target)) return;
    const t = composerText(c);
    if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openPreview(t);
  }, true);
  document.addEventListener("click", (e) => {
    if (bypass || !outActive()) return;
    const b = e.target.closest && e.target.closest('button,[role="button"]');
    if (!b || !b.closest("#main footer") || !b.querySelector('[data-icon="send"]')) return;
    const t = composerText(composer());
    if (!t) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openPreview(t);
  }, true);

  // ---------- Araç çubuğu ----------
  let bar = null, panel = null, barKey = "";
  function buildBar() {
    bar = el("div", "uyt-bar");
    const tgl = el("button", "uyt-tgl"); tgl.type = "button";
    const more = el("button", "uyt-more", "⚙"); more.type = "button"; more.title = "Çeviri ayarları";
    panel = el("div", "uyt-panel"); panel.hidden = true;
    const mk = (label, node) => { const l = el("label", "uyt-row"); l.append(el("span", null, label), node); return l; };
    const selT = el("select", "uyt-sel"); for (const [c, n] of LANGS) selT.append(new Option(n, c));
    const selO = el("select", "uyt-sel"); selO.append(new Option("Otomatik (karşı tarafın dili)", "auto")); for (const [c, n] of LANGS) selO.append(new Option(n, c));
    const cAuto = el("input"); cAuto.type = "checkbox";
    const cOut = el("input"); cOut.type = "checkbox";
    const cEnter = el("input"); cEnter.type = "checkbox";
    panel.append(mk("Benim dilim (gelen mesajlar buna çevrilir)", selT), mk("Otomatik çevir", cAuto), mk("Giden mesajı çevir (önizlemeli)", cOut), mk("Karşıya giden dil (yazdığım bu dile çevrilir)", selO), mk("WhatsApp'ta Enter gönderiyor (kapalıysa Ctrl+Enter)", cEnter));
    diagEl = el("div", "uyt-meta"); panel.append(diagEl);
    bar.append(tgl, more, panel);
    document.body.appendChild(bar);
    tgl.onclick = () => { chatSet({ on: !isOn() }); refreshBar(); schedule(); };
    more.onclick = () => { panel.hidden = !panel.hidden; };
    selT.onchange = () => { cfg.settings.target = selT.value; saveCfg(); cache.clear(); for (const [r] of messageTexts()) if (r.__uyt) { r.__uyt.wrap?.remove(); r.__uyt = null; } schedule(); };
    cAuto.onchange = () => { chatSet({ auto: cAuto.checked }); schedule(); };
    cOut.onchange = () => chatSet({ outOn: cOut.checked });
    cEnter.onchange = () => { cfg.settings.enterSend = cEnter.checked; saveCfg(); };
    selO.onchange = () => chatSet({ out: selO.value });
    bar.refresh = () => {
      tgl.textContent = "🌐 Çeviri: " + (isOn() ? "AÇIK" : "KAPALI");
      tgl.classList.toggle("on", isOn());
      selT.value = cfg.settings.target; cAuto.checked = isAuto(); cOut.checked = outOn(); selO.value = outLang(); cEnter.checked = cfg.settings.enterSend !== false;
    };
  }
  function refreshBar() { bar?.refresh?.(); document.body.classList.toggle("uyt-off", !isOn()); }
  function placeBar() {
    const m = $("#main");
    if (!m) { if (bar) bar.style.display = "none"; closePop(); return; }
    if (!bar) { buildBar(); refreshBar(); }
    const h = $("header", m), mr = m.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : { bottom: mr.top + 60 };
    bar.style.display = "";
    Object.assign(bar.style, { top: hr.bottom + 6 + "px", right: Math.max(8, window.innerWidth - mr.right + 14) + "px" });
    placePop();
  }

  // ---------- Tarama ----------
  function detectDark() {
    let d = document.body.classList.contains("dark") || document.documentElement.classList.contains("dark") || document.documentElement.getAttribute("data-theme") === "dark";
    if (!d) { const m = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || []).map(Number); d = m.length >= 3 && m[0] + m[1] + m[2] < 300 && (m[3] === undefined || m[3] > 0); }
    document.documentElement.classList.toggle("uyt-dark", !!d);
  }
  let timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(scan, 200); }
  function scan() {
    detectDark();
    placeBar();
    const k = chatKey();
    if (k !== barKey) { barKey = k; closePop(); refreshBar(); }
    if (!$("#main") || !isOn()) return;
    const all = messageTexts(), inc = all.filter(([b]) => isIncoming(b));
    const live = [];
    for (const [r, te] of inc) { const st = processRow(r, te); if (st) live.push([r, st]); }
    if (isAuto()) for (const [r, st] of live.slice(-15)) if (!st.started && !st.res && (st.fails || 0) < 2) { st.started = true; translateRow(r, false); }
    diag(`Teşhis: ${all.length} mesaj metni, ${inc.length} gelen, ${live.length} çevrilebilir, ${document.querySelectorAll(".uyt-btn").length} düğme · hedef: ${langName(cfg.settings.target)} · motor: ${cfg.settings.engine}`);
  }
  let diagEl = null;
  function diag(t) { if (diagEl) diagEl.textContent = t; }

  const css = `
.uyt-wrap{margin-top:3px;font-size:inherit;line-height:inherit;clear:both}
.uyt-btn{all:unset;cursor:pointer;font-size:11.5px;color:#128c7e;opacity:.9}
.uyt-btn:hover{text-decoration:underline;opacity:1}
.uyt-tr{margin-top:3px;padding-top:4px;border-top:1px dashed rgba(127,127,127,.55);white-space:pre-wrap;word-break:break-word;font-size:inherit;line-height:inherit}
.uyt-tr .uyt-text{color:inherit}
.uyt-tr.uyt-err{color:#e53935;font-size:12px}
.uyt-meta{font-size:10.5px;opacity:.7;margin-top:2px}
.uyt-meta.uyt-err{color:#e53935;opacity:1}
.uyt-bar{position:fixed;z-index:99999;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;max-width:340px;font:12px system-ui,sans-serif}
.uyt-bar>button{all:unset;cursor:pointer;padding:3px 9px;border-radius:12px;background:#667781;color:#fff;font:600 11.5px system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.uyt-bar>.uyt-tgl.on{background:#128c7e}
.uyt-panel{flex-basis:100%;background:#fff;color:#111;border-radius:8px;padding:8px 10px;box-shadow:0 2px 10px rgba(0,0,0,.35);display:grid;gap:6px}
.uyt-panel[hidden]{display:none}
.uyt-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.uyt-sel{font:12px system-ui,sans-serif;max-width:170px}
.uyt-pop{position:fixed;z-index:99999;background:#fff;color:#111;border-radius:10px;padding:10px 12px;box-shadow:0 4px 18px rgba(0,0,0,.4);font:13px system-ui,sans-serif;display:grid;gap:6px}
.uyt-pop-h{display:flex;justify-content:space-between;align-items:center;gap:8px}
.uyt-ta{width:100%;box-sizing:border-box;font:14px system-ui,sans-serif;padding:6px 8px;border:1px solid #bbb;border-radius:6px;resize:vertical;background:#fff;color:#111}
.uyt-orig{font-size:11.5px;opacity:.65;max-height:48px;overflow:auto;white-space:pre-wrap}
.uyt-pop-b{display:flex;gap:6px;justify-content:flex-end}
.uyt-pop-b button{all:unset;cursor:pointer;padding:5px 12px;border-radius:14px;font:600 12px system-ui,sans-serif}
.uyt-go{background:#25d366;color:#073b1d}
.uyt-go[disabled]{opacity:.5;cursor:default}
.uyt-ghost{background:rgba(127,127,127,.2);color:inherit}
.uyt-dark .uyt-panel,.uyt-dark .uyt-pop{background:#233138;color:#e9edef}
.uyt-dark .uyt-ta{background:#2a3942;color:#e9edef;border-color:#3b4a54}
.uyt-dark .uyt-btn{color:#53bdeb}
.uyt-off .uyt-wrap{display:none}
`;
  const style = document.createElement("style");
  style.id = "uyt-style";
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  loadCfg().then(() => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => { placeBar(); });
    setInterval(placeBar, 1500);
    scan();
  });
})();
