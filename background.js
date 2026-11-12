// WhatsApp Çevirmen: arka plan. Çeviri isteklerini AI sağlayıcılarına iletir; yazı kutusu için yedek gerçek girdi sağlar.
import "./translate-bg.js"; // self.uyTranslate tanımlar

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === "install") chrome.runtime.openOptionsPage(); });

// WhatsApp çeviri: içerik betiğinden gelen istekler. Yalnızca WhatsApp Web sekmesinden kabul edilir (debugger yetkisi başka sekmeye kullanılamasın).
const fromWa = (sender) => /^https:\/\/web\.whatsapp\.com\//.test((sender && (sender.url || (sender.tab && sender.tab.url))) || "");
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!fromWa(sender)) { reply({ ok: false, error: "izin verilmeyen kaynak" }); return; }
  if (msg?.type === "uy-translate") {
    self.uyTranslate(msg.req).then((r) => reply({ ok: true, ...r }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "uy-input" && sender.tab) { // yedek: yazı kutusunu gerçek girdiyle doldur (Ctrl+A, Backspace, metin)
    const target = { tabId: sender.tab.id };
    const send = (m, p) => chrome.debugger.sendCommand(target, m, p);
    const key = (k, extra = {}) => send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, ...extra })
      .then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, ...extra }));
    (async () => {
      let mine = false;
      try {
        try { await chrome.debugger.attach(target, "1.3"); mine = true; } catch (e) { if (!/already/i.test(e.message)) throw e; }
        await key({ key: "a", code: "KeyA", vk: 65 }, { modifiers: 2, commands: ["selectAll"] });
        await key({ key: "Backspace", code: "Backspace", vk: 8 });
        const lines = String(msg.text || "").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (i) await key({ key: "Enter", code: "Enter", vk: 13 }, { modifiers: 8 }); // Shift+Enter: satır sonu
          if (lines[i]) await send("Input.insertText", { text: lines[i] });
        }
        reply({ ok: true });
      } catch (e) { reply({ ok: false, error: e.message }); }
      finally { if (mine) await chrome.debugger.detach(target).catch(() => {}); }
    })();
    return true;
  }
  if (msg?.type === "uy-enter" && sender.tab) { // yedek: gerçek (trusted) Enter tuşu
    const target = { tabId: sender.tab.id };
    (async () => {
      try {
        let mine = false;
        try { await chrome.debugger.attach(target, "1.3"); mine = true; } catch (e) { if (!/already/i.test(e.message)) throw e; }
        const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" };
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", ...key });
        await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
        if (mine) await chrome.debugger.detach(target).catch(() => {});
        reply({ ok: true });
      } catch (e) { reply({ ok: false, error: e.message }); }
    })();
    return true;
  }
});

