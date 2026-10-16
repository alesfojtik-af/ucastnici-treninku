"use strict";
// Účastníci tréninku: přihlašování na tréninky, záskoky, rozpočítání plateb a QR platba.
// Data drží Supabase; aplikace volá jen databázové funkce (viz supabase/schema.sql).

// ---------- API ----------
const CFG = window.APP_CONFIG || {};
async function api(fn, args) {
  if (!CFG.supabaseUrl || !CFG.supabaseKey) throw new Error("Aplikace ještě není připojená k databázi (config.js).");
  const headers = { "Content-Type": "application/json", apikey: CFG.supabaseKey };
  if (CFG.supabaseKey.startsWith("eyJ")) headers.Authorization = "Bearer " + CFG.supabaseKey;
  const res = await fetch(`${CFG.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args || {}) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body.message || body.hint)) || `Chyba serveru (${res.status})`);
  return body;
}

// ---------- úložiště v prohlížeči (jen pohodlí: kdo jsem, otevřené skupiny, PIN) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
function rememberGroup(slug, name, status) {
  const list = store.get("groups", []).filter(g => g.slug !== slug);
  list.unshift({ slug, name, status }); store.set("groups", list.slice(0, 20));
}

// ---------- stav ----------
const slug = new URLSearchParams(location.search).get("g");
let D = null;            // data skupiny z app_get
let att = {}, cash = {}; // att[den][osoba] = {st, ts}; cash[den] = osoba
let tab = "week", idx = 0, payDay = null, confirmDel = null, pickFor = null, addG = "z", ngType = "week";
let superData = null, busy = false;
let wa = null, waConfirm = null; // wa = záznamy odeslaných/ignorovaných zpráv (null = migrace 002 ještě neběžela)
const DAY = 864e5;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t) { const e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3200); }
const kc = v => Math.round(v).toLocaleString("cs-CZ") + " Kč";
const sign = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toLocaleString("cs-CZ") + " Kč";
const plural = (n, a, b, c) => n === 1 ? a : n >= 2 && n <= 4 ? b : c;
const places = n => plural(n, "místo", "místa", "míst");
const players = n => plural(n, "hráč", "hráči", "hráčů");
const subs = n => plural(n, "záskok", "záskoci", "záskoků");
const byName = (x, y) => x.n.localeCompare(y.n, "cs");
const fmtD = k => { const d = new Date(k + "T12:00:00Z"); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`; };
const iso = t => new Date(t).toISOString().slice(0, 10);

const C = () => D.group.cfg;
const hm = t => (t || "").replace(/^0(\d)/, "$1");
const people = () => D.people.filter(p => p.active);
const P = id => D.people.find(p => p.id == id);
const meId = () => store.get("me:" + slug, null);
const me = () => { const p = P(meId()); return p && p.active ? p : null; };
const adminPin = () => store.get("pin:" + slug, null);
const superPin = () => store.get("superpin", null);
const anyPin = () => adminPin() || superPin(); // PIN pro admin akce: admin skupiny, jinak správce aplikace
const isGroupAdmin = () => !!(me() && me().id == D.group.admin_person);
const canSettings = () => isGroupAdmin() || !!adminPin() || !!superPin();
const trCost = () => C().tr?.on ? +C().tr.price || 0 : 0;
const court = () => C().ct?.on ? Math.round((+C().ct.hour || 0) * (+C().ct.hours || 0)) : 0;
const trName = () => C().tr?.name || "Trenér";
const ctName = () => C().ct?.name || "Kurt";

// ---------- termíny ----------
function days() {
  const c = C();
  if (c.type === "once") return [c.date];
  const start = Date.parse(c.start + "T12:00:00Z"), n = Math.max(1, +c.weeks || 1);
  return [...Array(n).keys()].map(i => iso(start + i * 7 * DAY));
}
function todayIso() { const t = Date.now(); return iso(t + (pragueOffset(iso(t)) === "+02:00" ? 2 : 1) * 3600e3); }
function currentIdx() {
  const ds = days(), t = todayIso();
  const i = ds.findIndex(d => d >= t);
  return i < 0 ? ds.length - 1 : i;
}
const inPrep = d => C().model === "prepay" && d >= C().prepFrom && d <= C().prepTo;
function pragueOffset(d) { // letní čas: poslední neděle v březnu až poslední neděle v říjnu
  const y = +d.slice(0, 4), lastSun = m => { const t = new Date(Date.UTC(y, m + 1, 0)); return iso(t - t.getUTCDay() * DAY); };
  return d >= lastSun(2) && d < lastSun(9) ? "+02:00" : "+01:00";
}
const atPrague = (d, t) => new Date(`${d}T${t || "00:00"}:00${pragueOffset(d)}`);
const sessionStart = d => atPrague(d, C().time);
const sessionEnd = d => atPrague(d, C().end || C().time);
const priorityActive = d => Date.now() < sessionStart(d).getTime() - 24 * 3600e3;

// ---------- výpočty ----------
function stats(d) {
  const a = att[d] || {}, all = people();
  const st = all.filter(p => p.g === "s"), zs = all.filter(p => p.g === "z");
  const sAno = st.filter(p => a[p.id]?.st === "ano"), sOpen = st.filter(p => !a[p.id]);
  const zQ = zs.filter(p => ["ano", "chci"].includes(a[p.id]?.st)).sort((x, y) => a[x.id].ts.localeCompare(a[y.id].ts));
  const zAno = zQ.filter(p => a[p.id].st === "ano"), zChci = zQ.filter(p => a[p.id].st === "chci");
  const n = sAno.length + zAno.length, cap = +C().cap || 99, free = cap - n;
  const tr = n ? Math.ceil(trCost() / n) : 0;
  const ct = n && court() ? Math.ceil(court() / n / 10) * 10 : 0, prep = inPrep(d);
  const ctOf = p => prep && p.g === "s" ? 0 : ct;
  const ahead = p => { const i = zQ.indexOf(p); return i < 0 ? zChci : zChci.filter(q => zQ.indexOf(q) < i); };
  const canAno = p => free > 0 && (p.g === "s" || !priorityActive(d) || ahead(p).length < free);
  return { a, sAno, sOpen, zQ, zAno, zChci, n, cap, free, tr, ct, ctOf, prep, ahead, canAno,
    trSum: tr * n, ctSum: [...sAno, ...zAno].reduce((x, p) => x + ctOf(p), 0) };
}

// ---------- avatar ----------
function avatar(p, size = 36) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px`;
  if (p.av != null && window.face) return `<span class="av" style="${st}">${face(p.av)}</span>`;
  return `<span class="av ini ${p.g === "z" ? "sub" : ""}" style="${st}">${esc(p.n.split(" ").map(x => x[0]).join("").slice(0, 2))}</span>`;
}
const MONEY = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/></svg>`;

// ---------- načtení ----------
async function load() {
  const r = await api("app_get", { p_slug: slug });
  if (r.error === "not_found") { D = { missing: true }; return; }
  D = r; att = {}; cash = {};
  if (D.group.status !== "active") { rememberGroup(slug, D.group.name, D.group.status); return; }
  D.people.forEach(p => { p.id = +p.id; });
  for (const x of D.att) (att[x.d] ||= {})[x.p] = { st: x.st, ts: x.ts };
  for (const x of D.days) cash[x.d] = x.cash;
  rememberGroup(slug, D.group.name, "active");
  try { wa = await api("app_wa_get", { p_slug: slug }); } catch { wa = null; }
  if (superPin()) try { const r = await api("super_list", { p_pin: superPin() }); if (r.ok) superData = r; } catch {}
}
async function refresh() {
  if (!slug || busy) return;
  try { await load(); render(); } catch (e) { /* tiché obnovení, chyba se ukáže při akci */ }
}
async function act(fn, args, okMsg) {
  busy = true;
  try {
    const r = await api(fn, args);
    if (r && r.ok === false) return r;
    if (slug) await load();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) { toast(e.message); return { ok: false, error: "exc" }; }
  finally { busy = false; render(); }
}

// ---------- hlavička a navigace ----------
function renderChrome() {
  const groups = store.get("groups", []);
  $("#grpsw").hidden = !groups.length && !slug;
  const opts = groups.map(g => `<option value="${esc(g.slug)}" ${g.slug === slug ? "selected" : ""}>${esc(g.name)}${g.status === "pending" ? " (čeká na schválení)" : ""}</option>`);
  if (!slug) opts.unshift(`<option value="" selected>Vyberte skupinu…</option>`);
  $("#grp").innerHTML = opts.join("") + `<option value="__new">＋ Založit novou skupinu…</option>`;

  const live = D && D.group && D.group.status === "active";
  $("#tabs").hidden = !live || !me() || tab === "new";
  $("#who").hidden = !live || !me();
  if (!live) {
    $("#kicker").textContent = ""; $("#title").textContent = D?.group?.name || "Účastníci tréninku";
    $("#coach").textContent = ""; $("#meta").textContent = ""; $("#weeknav").hidden = true;
    document.title = D?.group?.name || "Účastníci tréninku";
    return;
  }
  const c = C();
  document.querySelector(".app").dataset.skin = c.skin || "beach";
  document.title = D.group.name;
  $("#kicker").textContent = [c.place, c.season].filter(Boolean).join(" · ");
  $("#title").textContent = D.group.name;
  const when = c.type === "once" ? `${fmtD(c.date)} ${hm(c.time)}` : `${c.dow || ""} ${hm(c.time)}`;
  $("#coach").innerHTML = c.coach ? `${esc(trName())} <b>${esc(c.coach)}</b> · ${esc(when.trim())}` : esc(when.trim());
  $("#meta").textContent = `${hm(c.time)}${c.end ? "–" + hm(c.end) : ""} · max ${c.cap} hráčů`;
  if (me()) {
    $("#me").innerHTML = [...people()].sort(byName).map(p => `<option value="${p.id}" ${p.id == meId() ? "selected" : ""}>${esc(p.n)}</option>`).join("");
    $("#meAv").innerHTML = avatar(me(), 30);
    $("#roleTag").textContent = superPin() ? "správce" : isGroupAdmin() ? "admin" : me().g === "s" ? "stálý" : "záskok";
  }
  const badge = waCards().length + (superPin() && superData ? superData.groups.filter(g => g.status === "pending").length : 0);
  $("#msgDot").textContent = badge; $("#msgDot").hidden = !badge;
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  const ds = days(), multi = ds.length > 1;
  $("#weeknav").hidden = tab !== "week" || !multi || !me();
  if (multi) {
    $("#rangeLbl").textContent = idx + 1 < ds.length ? `${fmtD(ds[idx])} a ${fmtD(ds[idx + 1])}` : fmtD(ds[idx]);
    $("#todayBtn").style.visibility = idx === currentIdx() ? "hidden" : "visible";
    $("#prev").disabled = idx <= 0; $("#next").disabled = idx >= ds.length - 2;
  }
}

function show(id) { document.querySelectorAll(".screen").forEach(s => s.hidden = s.id !== "s-" + id); }

function render() {
  renderChrome();
  if (tab === "new") { show("new"); renderNew(); return; }
  if (!slug) { show("home"); renderHome(); return; }
  if (!D) { show("loading"); return; }
  if (D.missing) { show("home"); renderHome("Skupina s tímto odkazem neexistuje. Zkontrolujte odkaz od organizátora."); return; }
  if (D.group.status !== "active") { show("home"); renderHome(D.group.status === "pending" ? `Skupina „${esc(D.group.name)}“ čeká na schválení správcem. Tento odkaz si uložte, po schválení začne fungovat.` : `Žádost o skupinu „${esc(D.group.name)}“ byla zamítnuta.`); return; }
  if (!me()) { show("pick"); renderPick(); return; }
  show(tab);
  ({ week: renderWeek, pay: renderPay, people: renderPeople, settings: renderSettings })[tab]();
}

// ---------- úvod bez skupiny ----------
function renderHome(msg) {
  const groups = store.get("groups", []);
  $("#s-home").innerHTML = `<div class="panel"><h2>Vítejte</h2>
    <p class="sub">${msg || "Otevřete odkaz, který vám poslal organizátor skupiny. Skupiny, které jste už otevřeli, najdete níže."}</p>
    ${groups.map(g => `<div class="person"><div class="nm">${esc(g.name)}<small>${g.status === "pending" ? "čeká na schválení" : "otevřená skupina"}</small></div><a class="btn small ghost" href="?g=${encodeURIComponent(g.slug)}">Otevřít</a></div>`).join("")}
    <button class="btn" data-goto-new style="margin-top:12px">Založit novou skupinu</button></div>`;
}

// ---------- kdo jsem ----------
function renderPick() {
  const list = [...people()].sort(byName);
  $("#s-pick").innerHTML = `<div class="panel"><h2>Kdo jste?</h2><p class="sub">Vyberte své jméno. Zapamatuje se v tomto telefonu, změnit ho jde kdykoli nahoře.</p>
    <div class="pickgrid">${list.map(p => `<button class="pickme" data-iam="${p.id}">${avatar(p, 44)}<span>${esc(p.n)}</span></button>`).join("")}</div></div>
    <div class="panel"><h2>Nejste v seznamu?</h2>
    <form class="addform" id="joinForm"><input id="joinName" placeholder="Jméno nebo přezdívka" aria-label="Jméno" required maxlength="40"><button class="btn" type="submit">Přidat se</button></form>
    <p class="sub" style="margin:8px 0 0">Přidáte se jako záskok. Mezi stálé vás může přesunout kdokoli ze skupiny.</p></div>`;
}

// ---------- týden ----------
function weekCard(d, label, isNow) {
  const s = stats(d), a = s.a, cap = s.cap;
  const bars = []; for (let i = 0; i < Math.max(cap, s.n); i++) { let c = i < s.sAno.length ? "on" : i < s.n ? "sub" : ""; if (i >= cap) c = "over"; bars.push(`<i class="${c}"></i>`); }
  const openTxt = s.sOpen.length ? `Ze stálých ${s.sOpen.length} ${plural(s.sOpen.length, "neodpověděl", "neodpověděli", "neodpovědělo")}: ${s.sOpen.sort(byName).map(p => esc(p.n)).join(", ").replace(/\.$/, "")}.` : "";
  let alert;
  if (s.free <= 0) alert = `<div class="alert">${s.free < 0 ? `Přes kapacitu o ${-s.free}.` : "Plno."} ${openTxt}</div>`;
  else if (s.zChci.length && priorityActive(d)) alert = `<div class="alert info">Volno: ${s.free} ${places(s.free)}. Přednost má ${esc(s.zChci[0].n)} (dřív klikl/a „šel bych“) až do 24 h před tréninkem. ${openTxt}</div>`;
  else alert = `<div class="alert info">Volno: ${s.free} ${places(s.free)}${s.zChci.length ? ". Místo dostane ten, kdo první dá ANO" : " pro záskok"}. ${openTxt}</div>`;

  const seg = (p, st) => {
    const dis = st !== "ano" && !s.canAno(p) ? "disabled" : "";
    return p.g === "s"
      ? `<div class="seg" role="group" aria-label="${esc(p.n)}"><button class="ano" aria-pressed="${st === "ano"}" data-d="${d}" data-p="${p.id}" data-v="ano" ${dis}>ANO</button><button class="ne" aria-pressed="${st === "ne"}" data-d="${d}" data-p="${p.id}" data-v="ne">NE</button></div>`
      : `<div class="seg" role="group" aria-label="${esc(p.n)}"><button class="chci" aria-pressed="${st === "chci"}" data-d="${d}" data-p="${p.id}" data-v="chci">Šel bych</button><button class="ne" aria-pressed="${st === "ne"}" data-d="${d}" data-p="${p.id}" data-v="ne">NE</button><button class="ano" aria-pressed="${st === "ano"}" data-d="${d}" data-p="${p.id}" data-v="ano" ${dis}>ANO</button></div>`;
  };
  const row = p => {
    const st = a[p.id]?.st; let note = "";
    if (p.g === "s" && !st) note = "<small>zatím neodpověděl(a)</small>";
    if (p.g === "z" && st === "ano") note = `<small><span class="order">#${s.zQ.indexOf(p) + 1}</span> hraje</small>`;
    if (p.g === "z" && st === "chci") note = `<small><span class="order wait">#${s.zQ.indexOf(p) + 1}</span> ${s.canAno(p) ? "může dát ANO" : "čeká na místo"}</small>`;
    return `<div class="row ${p.id == meId() ? "me" : ""}">${avatar(p, 32)}<div class="nm">${esc(p.n)}${note}</div>${seg(p, st)}</div>`;
  };
  const m = me();
  const st = people().filter(p => p.g === "s" && p.id !== m.id).sort(byName), zs = people().filter(p => p.g === "z" && p.id !== m.id).sort(byName);
  const cashOpts = ['<option value="">— nikdo —</option>', ...[...people()].sort(byName).map(p => `<option value="${p.id}" ${cash[d] == p.id ? "selected" : ""}>${esc(p.n)}</option>`)].join("");
  return `<article class="week">
    <div class="sum"><span class="sum-ano"><b class="num">${s.n}× ANO</b> z ${cap}</span><span class="sum-open">${s.sOpen.length ? `${s.sOpen.length} ${plural(s.sOpen.length, "stálý nepotvrdil", "stálí nepotvrdili", "stálých nepotvrdilo")}` : "všichni stálí odpověděli"}</span></div>
    <div class="week-h"><div><span class="badge ${isNow ? "now" : ""}">${label}</span><div class="date" style="margin-top:6px">${esc((C().dow || "").slice(0, 2).replace(/^./, c => c.toUpperCase()))} ${fmtD(d)}</div></div>
      <div class="cap"><small>${s.sAno.length} stálých + ${s.zAno.length} ${subs(s.zAno.length)}</small></div></div>
    <div class="courts" aria-hidden="true">${bars.join("")}</div>${alert}
    <div class="grp"><span>Ty</span><span>${m.g === "s" ? "stálý" : "záskok"}</span></div>${row(m)}
    <div class="grp" style="margin-top:6px"><span>Stálí${C().model === "prepay" ? " (předplacený " + esc(ctName().toLowerCase()) + ")" : ""}</span><span class="num">${s.sAno.length}× ANO</span></div>${st.map(row).join("")}
    <div class="grp" style="margin-top:6px"><span>Záskoky (legenda níže)</span><span class="num">${s.zAno.length}× ANO · ${s.zChci.length}× šel bych</span></div>${zs.map(row).join("")}
    <p class="legend"><b>Legenda:</b> Pro zájem o účast klikni „Šel bych“, zaznamená se pořadí. Jakmile je volné místo ze stálých, zvol ANO. Přednost má ten, kdo byl dřív v „Šel bych“.</p>
    ${C().tr?.on ? `<div class="week-f"><label for="cash-${d}">Cash přinese</label><select id="cash-${d}" data-cash="${d}">${cashOpts}</select>
      <button class="btn small" data-gopay="${d}">Platba →</button></div>` : `<div class="week-f"><button class="btn small" data-gopay="${d}">Platba →</button></div>`}
  </article>`;
}
function renderWeek() {
  const ds = days(), cur = currentIdx();
  const lab = i => ds.length === 1 ? "Termín" : i === cur ? "Tento týden" : i === cur + 1 ? "Příští týden" : i < cur ? "Proběhlo" : "Plánováno";
  let h = weekCard(ds[idx], lab(idx), idx === cur);
  if (idx + 1 < ds.length) h += weekCard(ds[idx + 1], lab(idx + 1), false);
  $("#s-week").innerHTML = h;
}

// ---------- platba ----------
function spd(amount) { return `SPD*1.0*ACC:${C().iban}*AM:${amount.toFixed(2)}*CC:CZK*MSG:${(C().msg || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\*/g, "").slice(0, 60)}`; }
function qrSvg(text) {
  try { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
  catch { return `<small style="color:#333">QR se nepodařilo vytvořit</small>`; }
}
function renderPay() {
  const ds = days(), d = payDay && ds.includes(payDay) ? payDay : ds[currentIdx()];
  const s = stats(d), pay = { d, s, c: court(), tc: trCost(), cp: P(cash[d]) };
  $("#s-pay").innerHTML = payCalcPanel(pay, ds) + payCashPanel(pay) + payCheckPanel(pay) + payWhoPanel(pay) + payQrPanel(pay)
    + (ds.length > 1 ? seasonPanel() : "");
}
function payCalcPanel({ d, s, c, tc }, ds) {
  const trPct = tc + c ? Math.round(tc / (tc + c) * 100) : 50;
  const opts = ds.map((x, i) => `<option value="${x}" ${x === d ? "selected" : ""}>${fmtD(x)}${i === currentIdx() && ds.length > 1 ? " (tento týden)" : ""}</option>`).join("");
  const perHead = (total, rounding, share, who) =>
    `${kc(total)} ÷ ${s.n} ${players(s.n)} = ${(total / s.n).toFixed(2).replace(".", ",")} Kč, zaokrouhleno nahoru na ${rounding} = <b>${kc(share)}</b> ${who}`;
  return `<div class="panel">
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><h2>Platba za termín</h2>
      ${ds.length > 1 ? `<select id="payDay" aria-label="Termín">${opts}</select>` : ""}</div>
    <p class="sub">Hraje <b class="num">${s.n}</b> lidí (${s.sAno.length} stálých + ${s.zAno.length} ${subs(s.zAno.length)}).</p>
    ${tc && c ? `<div class="bar" aria-hidden="true"><i style="width:${trPct}%;background:var(--sea)"></i><i style="width:${100 - trPct}%;background:var(--sun)"></i></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
      <span>${esc(trName())} ${kc(tc)}</span><span>${esc(ctName())} ${kc(c)} / termín</span></div>` : ""}
    <div class="split" style="margin-top:12px">
      ${tc ? `<div class="kpi"><small>${esc(trName())} / os.</small><b class="num">${s.n ? kc(s.tr) : "—"}</b><span>platí všichni</span></div>` : ""}
      ${c ? `<div class="kpi"><small>${esc(ctName())} / ${s.prep ? "záskok" : "hráč"}</small><b class="num">${s.n ? kc(s.ct) : "—"}</b>
        <span>${s.prep ? "stálí mají předplaceno" : "platí všichni"}</span></div>` : ""}
    </div>
    <div class="calc num">${!s.n ? "Zatím nikdo nepotvrdil ANO." : [
      tc ? `<div><b>${esc(trName())}:</b> ${perHead(tc, "koruny", s.tr, "na každého.")}</div>` : "",
      c ? `<div><b>${esc(ctName())}:</b> ${perHead(c, "desetikoruny", s.ct, s.prep ? "na každého záskoka. Stálí mají kurt předplacený." : "na každého hráče.")}</div>` : ""].join("")}</div>
  </div>`;
}
function payCashPanel({ s, tc, cp }) {
  if (!tc) return "";
  const cashIn = cp && [...s.sAno, ...s.zAno].includes(cp);
  return `<div class="panel cashp"><h2>${esc(trName())}: hotově</h2>
    ${cp ? `<div class="cashrow">${avatar(cp, 44)}<div><b>${esc(cp.n)}</b> přinese ${kc(tc)} hotově a zaplatí.<br>
      <span class="sub">Ostatní pošlou po <b class="num">${kc(s.tr)}</b> přes QR, které ${esc(cp.n)} dá do WhatsApp skupiny.</span></div></div>
      <p class="sub num" style="margin:10px 0 0">Kontrola: ${cashIn ? `${s.n - 1} × ${kc(s.tr)} od ostatních + vlastní podíl ${kc(s.tr)}` : `${s.n} × ${kc(s.tr)}`}
        = ${kc(s.trSum)} proti ${kc(tc)}, rozdíl ${sign(s.trSum - tc)}.</p>`
      : `<p class="sub" style="margin:0">Zatím nikdo nevybral, kdo přinese cash. Nastavíte to dole na kartě termínu.</p>`}</div>`;
}
function payCheckPanel({ s, c, tc }) {
  const diff = (sum, price) => `<span class="${sum >= price ? "paid" : "unpaid"}">${sign(sum - price)}</span>`;
  const row = (name, price, got, result) => `<tr><td>${name}</td><td class="r">${price}</td><td class="r">${got}</td><td class="r">${result}</td></tr>`;
  const note = t => `<br><small style="color:var(--muted)">${t}</small>`;
  const courtRows = !c ? "" : s.prep
    ? row(esc(ctName()) + note("kryto předplatným"), kc(c), kc(c), `<span class="paid">✓</span>`)
      + row(`${esc(ctName())} od záskoků` + note("jde do kasy"), "–", kc(s.ctSum), `<span class="paid">${sign(s.ctSum)}</span>`)
    : row(esc(ctName()), kc(c), kc(s.ctSum), diff(s.ctSum, c));
  return `<div class="panel"><h2>Kontrola termínu</h2><p class="sub">Sedí vybrané peníze na cenu?</p>
    <table class="num"><thead><tr><th>Položka</th><th class="r">Cena</th><th class="r">Vybráno</th><th class="r">Rozdíl</th></tr></thead><tbody>
      ${tc ? row(esc(trName()), kc(tc), kc(s.trSum), diff(s.trSum, tc)) : ""}${courtRows}
    </tbody></table>
    ${C().model === "prepay" ? `<p class="sub" style="margin-top:8px">Předplacené období: ${fmtD(C().prepFrom)} – ${fmtD(C().prepTo)}
      Tento termín ${s.prep ? "<b>je</b> v něm" : "<b>není</b> v něm"}.</p>` : ""}
  </div>`;
}
function payWhoPanel({ s, c, tc }) {
  const rows = [...[...s.sAno].sort(byName), ...[...s.zAno].sort(byName)].map(p => ({ p, tr: s.tr, ct: s.ctOf(p) }));
  const sumTr = rows.reduce((x, r) => x + r.tr, 0), sumCt = rows.reduce((x, r) => x + r.ct, 0);
  const cells = (tr, ct, total) => `${tc ? `<td class="r">${tr}</td>` : ""}${c ? `<td class="r">${ct}</td>` : ""}<td class="r">${total}</td>`;
  return `<div class="panel"><h2>Kdo kolik platí</h2>
    <div style="overflow-x:auto"><table class="num">
      <thead><tr><th>Hráč</th>${tc ? `<th class="r">${esc(trName())}</th>` : ""}${c ? `<th class="r">${esc(ctName())}</th>` : ""}<th class="r">Celkem</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.p.n)} <span class="tag ${r.p.g === "z" ? "sub" : ""}">${r.p.g === "z" ? "Záskok" : "Stálý"}</span></td>
        ${cells(kc(r.tr), r.ct ? kc(r.ct) : "–", `<b>${kc(r.tr + r.ct)}</b>`)}</tr>`).join("")}</tbody>
      <tfoot><tr><td>Vybráno</td>${cells(kc(sumTr), kc(sumCt), kc(sumTr + sumCt))}</tr></tfoot></table></div>
  </div>`;
}
function payQrPanel({ s, c }) {
  if (!c || !C().iban) return "";
  return `<div class="panel"><h2>QR platba: ${esc(ctName().toLowerCase())}</h2>
    <p class="sub">${s.prep ? "Pro záskoky." : "Pro všechny hráče."} Částka se dopočítá podle počtu hráčů.</p>
    <div class="qrwrap"><div class="qr">${qrSvg(spd(s.ct))}</div>
      <div class="qrinfo"><b class="num">${kc(s.ct)}</b><span>Zpráva: <i>${esc(C().msg)}</i></span>
        <span class="acc">${esc(C().iban).replace(/(.{4})/g, "$1 ").trim()}</span>
        <button class="btn ghost small" id="copyAcc" style="align-self:flex-start">Kopírovat číslo účtu</button></div></div></div>`;
}
function seasonPanel() {
  let trD = 0, ctZ = 0; const ds = days(), cur = currentIdx(), c = court();
  const rows = ds.map((d, i) => { const s = stats(d);
    if (s.n) { trD += s.trSum - trCost(); ctZ += s.prep ? s.ctSum : s.ctSum - c; }
    return `<tr${i === cur ? ' class="cur"' : ""}><td>${fmtD(d)}${i > cur ? ' <span class="tag">plán</span>' : ""}</td><td class="r">${s.n || "–"}</td><td class="r">${s.n && c ? kc(s.ctSum) : "–"}</td></tr>`; }).join("");
  const st = people().filter(p => p.g === "s"), paid = st.filter(p => p.paid).length, need = ds.filter(inPrep).length * c;
  return `<div class="panel"><h2>Přehled sezóny</h2>
    <div class="split" style="margin-bottom:12px">
      ${C().model === "prepay" ? `<div class="kpi"><small>Předplatné</small><b class="num">${kc(paid * (+C().prepay || 0))}</b><span>z ${kc(need)} · ${paid}/${st.length} stálých zaplatilo</span></div>` : ""}
      <div class="kpi"><small>Kasa (${C().model === "prepay" ? "od záskoků" : "přebytek"})</small><b class="num">${kc(ctZ)}</b><span>${trCost() ? `${esc(trName().toLowerCase())}: ${sign(trD)} za sezónu` : ""}</span></div>
    </div>
    <div style="overflow-x:auto"><table class="num"><thead><tr><th>Termín</th><th class="r">Hráčů</th><th class="r">${C().model === "prepay" ? "Od záskoků" : "Vybráno"}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---------- lidé ----------
function renderPeople() {
  const grp = (g, title, sub) => {
    const list = people().filter(p => p.g === g).sort(byName);
    return `<div class="panel"><h2>${title} <span class="num" style="color:var(--muted);font-weight:600;font-size:16px">${list.length}</span></h2><p class="sub">${sub}</p>
    ${list.map(p => `<div class="person"><button class="avbtn" data-pick="${p.id}" aria-label="Zvolit ikonku pro ${esc(p.n)}">${avatar(p, 40)}</button>
      <div class="nm">${esc(p.n)}${p.id == meId() ? ' <span class="tag">ty</span>' : ""}${g === "s" && C().model === "prepay" ? `<small>Předplatné ${kc(+C().prepay || 0)}: ${p.paid ? '<span class="paid">zaplaceno</span>' : '<span class="unpaid">nezaplaceno</span>'}</small>` : ""}
        <small class="mail">${p.email ? `✉ ${esc(p.email)}` : `<button class="linkbtn" data-mail="${p.id}">přidat e-mail pro upozornění</button>`}</small></div>
      ${confirmDel === p.id ? `<div class="confirm"><span>Odebrat?</span><button class="btn small danger" data-del="${p.id}">Ano</button><button class="btn small ghost" data-cancel>Ne</button></div>` :
      `${g === "s" && C().model === "prepay" && canSettings() ? `<button class="iconbtn ${p.paid ? "ok" : ""}" data-paid="${p.id}" title="Zaplaceno předplatné" aria-label="Přepnout zaplaceno u ${esc(p.n)}">${MONEY}</button>` : ""}
       <button class="iconbtn" data-move="${p.id}" title="${g === "s" ? "Přesunout mezi záskoky" : "Přesunout mezi stálé"}" aria-label="Přesunout ${esc(p.n)}">⇅</button>
       <button class="iconbtn" data-askdel="${p.id}" aria-label="Odebrat ${esc(p.n)}">✕</button>`}
    </div>
    ${pickFor === p.id ? `<div class="picker" role="group" aria-label="Ikonky">${[...Array(AV_COUNT).keys()].map(i => `<button class="face ${p.av === i ? "sel" : ""}" data-face="${i}" data-for="${p.id}" aria-label="Ikonka ${i + 1}">${face(i)}</button>`).join("")}</div>` : ""}`).join("")}</div>`;
  };
  $("#s-people").innerHTML = `<div class="panel"><h2>Přidat hráče</h2><p class="sub">Přidat může kdokoli ze skupiny.</p>
    <form class="addform" id="addForm"><input id="newName" placeholder="Jméno nebo přezdívka" aria-label="Jméno" required maxlength="40">
      <button class="btn" type="submit">Přidat</button>
      <input id="newMail" type="email" placeholder="E-mail pro upozornění (nepovinné)" aria-label="E-mail" style="grid-column:1/-1">
      <div class="seg" role="group" aria-label="Skupina"><button type="button" class="ano" data-ng="s" aria-pressed="${addG === "s"}">Stálý</button><button type="button" class="chci" data-ng="z" aria-pressed="${addG === "z"}">Záskok</button></div></form>
    <p class="sub" style="margin:10px 0 0">Ikonku si každý zvolí klepnutím na kolečko u svého jména. E-maily zatím slouží jen pro budoucí upozornění.</p></div>`
    + grp("s", "Stálí", C().model === "prepay" ? `Mají předplacený ${esc(ctName().toLowerCase())}, platí jen ${esc(trName().toLowerCase())}a.` : "Mají přednost, místo mají jisté.")
    + grp("z", "Záskoky", "Hrají, když je volné místo.");
}

// ---------- zprávy do WhatsAppu ----------
// Karty se počítají z dat: status od neděle 20:00 před termínem do začátku, pak změny proti poslednímu odeslání,
// platba 5 minut po konci, dokud ji někdo neodešle (nejdéle do nedělního statusu na další termín).
function statusFrom(d) { const dow = new Date(d + "T12:00:00Z").getUTCDay(), sun = iso(Date.parse(d + "T12:00:00Z") - (dow || 7) * DAY); return atPrague(sun, "20:00"); }
const waLog = (d, ...k) => (wa || []).filter(x => x.d === d && k.includes(x.k));
const dayLabel = d => `${C().type === "once" ? "" : (C().dow || "") + " "}${fmtD(d)}`.trim();
const dayUrl = d => `${location.origin}${location.pathname}?g=${encodeURIComponent(slug)}&d=${d}`;
const ST = { ano: "ANO", ne: "NE", chci: "šel bych" };
const names = list => list.map(p => p.n).join(", ");

function cashSuggestion(d) {
  if (cash[d] && P(cash[d])) return { p: P(cash[d]), set: true };
  const a = att[d] || {}, st = people().filter(p => p.g === "s");
  let cand = st.filter(p => a[p.id]?.st === "ano"); if (!cand.length) cand = st.filter(p => a[p.id]?.st !== "ne");
  const past = days().filter(x => x < d && cash[x]);
  const info = p => { const mine = past.filter(x => cash[x] == p.id); return { p, n: mine.length, last: mine[mine.length - 1] || "" }; };
  const best = cand.map(info).sort((x, y) => x.n - y.n || x.last.localeCompare(y.last) || byName(x.p, y.p))[0];
  return best || null;
}
function statusText(d) {
  const s = stats(d), cs = C().tr?.on ? cashSuggestion(d) : null;
  return [`🏐 *${D.group.name} · ${dayLabel(d)} · ${hm(C().time)}*`,
    `✅ Jde: *${s.n} z ${s.cap}*`,
    s.sOpen.length ? `❓ Stálí bez odpovědi: ${names([...s.sOpen].sort(byName))}` : "✅ Všichni stálí odpověděli",
    s.free > 0 ? `🟢 Volno: *${s.free} ${places(s.free)}*` : "🔴 Plno",
    s.zChci.length ? `🙋 Šel bych (pořadí): ${s.zChci.map((p, i) => `${i + 1}. ${p.n}`).join(", ")}` : "",
    !cs ? "" : cs.set ? `💵 Cash přinese: *${cs.p.n}*` : `💵 Kdo přinese cash? Návrh: *${cs.p.n}* (${cs.last ? "naposledy " + fmtD(cs.last) : "zatím nikdy"})`,
    `👉 Odpovězte v aplikaci: ${dayUrl(d)}`].filter(Boolean).join("\n");
}
function changesOf(d) {
  const base = waLog(d, "status", "changes").pop()?.s || {}, a = att[d] || {};
  const ids = new Set([...Object.keys(base), ...Object.keys(a).map(String)]);
  return [...ids].map(id => ({ p: P(id), from: base[id] || null, to: a[id]?.st || null })).filter(x => x.p && x.from !== x.to).sort((x, y) => byName(x.p, y.p));
}
function changesText(d, ch) {
  const s = stats(d), ic = { ano: "✅", ne: "❌", chci: "🙋" };
  return [`🔄 *Změny · ${dayLabel(d)}*`,
    ...ch.map(x => `${ic[x.to] || "↩️"} ${x.p.n}: ${x.from ? ST[x.from] + " → " : ""}*${x.to ? ST[x.to] : "bez odpovědi"}*`),
    `✅ Jde: *${s.n} z ${s.cap}* · ${s.free > 0 ? `🟢 volno *${s.free} ${places(s.free)}*` : "🔴 plno"}`,
    s.free > 0 && s.zChci.length ? `🙋 Na řadě: ${s.zChci[0].n}` : "",
    `👉 ${dayUrl(d)}`].filter(Boolean).join("\n");
}
function payText(d) {
  const s = stats(d), cp = P(cash[d]), tc = trCost(), c = court();
  return [`💸 *Platba · ${dayLabel(d)}* (${plural(s.n, "hrál", "hráli", "hrálo")} ${s.n})`,
    tc ? (cp ? `🧑‍🏫 ${trName()} ${kc(tc)} zaplatil(a) hotově *${cp.n}*\n→ ostatní pošlete ${cp.n} po *${kc(s.tr)}*` : `🧑‍🏫 ${trName()}: *${kc(s.tr)}* na osobu. Kdo přinesl cash? Doplňte v aplikaci.`) : "",
    c ? (s.prep ? (s.zAno.length ? `🏐 ${ctName()}: ${s.zAno.length === 1 ? "záskok" : "záskoci"} ${names([...s.zAno].sort(byName))} ${s.zAno.length === 1 ? "pošle" : "pošlou"} *${kc(s.ct)}* přes QR v aplikaci` : `🏐 ${ctName()} mají stálí předplacený.`) : `🏐 ${ctName()}: každý pošle *${kc(s.ct)}* přes QR v aplikaci`) : "",
    tc && cp ? `🙏 ${cp.n}, hoď sem prosím svůj QR kód.` : "",
    `👉 ${dayUrl(d)}`].filter(Boolean).join("\n");
}
function waCards() {
  if (!D?.group?.cfg || wa === null) return [];
  const now = Date.now(), ds = days(), out = [];
  ds.forEach((d, i) => {
    const start = sessionStart(d).getTime();
    if (now >= statusFrom(d).getTime() && now < start) {
      if (!waLog(d, "status").length) out.push({ d, k: "status", ic: "📋", title: "Nedělní status", sub: `na ${dayLabel(d)}`, text: statusText(d) });
      else { const ch = changesOf(d); if (ch.length) out.push({ d, k: "changes", ic: "🔄", title: "Změny od posledního odeslání", sub: `${dayLabel(d)} · ${ch.length} ${plural(ch.length, "změna", "změny", "změn")}`, text: changesText(d, ch) }); }
    }
    const until = i + 1 < ds.length ? statusFrom(ds[i + 1]).getTime() : sessionEnd(d).getTime() + 7 * DAY;
    if (now >= sessionEnd(d).getTime() + 5 * 60e3 && now < until && !waLog(d, "pay").length && stats(d).n)
      out.push({ d, k: "pay", ic: "💸", title: "Platba za termín", sub: `${dayLabel(d)} · ${cash[d] && P(cash[d]) ? "cash přinesl(a) " + P(cash[d]).n : "chybí, kdo přinesl cash"}`, warn: trCost() && !P(cash[d]) ? "Nejdřív doplňte na kartě termínu, kdo přinesl cash." : "", text: payText(d) });
  });
  return out;
}
function msgsPanel(admin) {
  if (wa === null) return `<div class="panel"><h2>Zprávy do WhatsAppu</h2><p class="sub" style="margin:0">Zprávy zatím nejsou zapnuté. Admin musí v databázi spustit aktualizaci (migrace 002).</p></div>`;
  const cards = waCards(), kindName = { status: "Nedělní status", changes: "Změny", pay: "Platba" };
  const recent = (wa || []).filter(x => Date.now() - Date.parse(x.at) < 7 * DAY).slice(-3).reverse();
  return `<div class="panel"><h2>Zprávy do WhatsAppu ${cards.length ? `<span class="cnt">${cards.length}</span>` : ""}</h2>
    <p class="sub">Poslat může kdokoli. Ťukněte na <b>Poslat do WhatsAppu</b>, vyberte skupinu a odešlete. Jakmile potvrdíte odeslání, zpráva zmizí i ostatním.</p>
    ${cards.length ? cards.map(m => { const key = `${m.d}|${m.k}`; return `<article class="msg">
      <header><span class="ic" aria-hidden="true">${m.ic}</span><div><b>${esc(m.title)}</b><small>${esc(m.sub)}</small></div><span class="st new">Nové</span></header>
      ${m.warn ? `<div class="alert" style="margin:10px 0 0">${esc(m.warn)}</div>` : ""}
      <pre class="bubble">${esc(m.text)}</pre>
      ${waConfirm === key ? `<div class="waconfirm">Odeslal(a) jste to do skupiny? <button class="btn small" data-wayes="${key}">Ano, odesláno</button><button class="btn small ghost" data-wano>Ještě ne</button></div>` :
      `<div class="acts"><button class="btn wa" data-wasend="${key}">Poslat do WhatsAppu</button><button class="btn small ghost" data-wacopy="${key}">Kopírovat</button>${admin ? `<button class="btn small ghost" data-waign="${key}">Ignorovat</button>` : ""}</div>`}
    </article>`; }).join("") : `<p class="sub" style="margin:0">Teď není nic k odeslání. 👌</p>`}
    ${recent.length ? `<h3>Naposledy</h3>${recent.map(x => `<p class="sub done">✓ ${kindName[x.k]} ${fmtD(x.d)} · ${x.a === "sent" ? "odeslal(a) " + esc(P(x.p)?.n || "někdo") : "ignorováno"} · ${new Date(x.at).toLocaleString("cs-CZ", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</p>`).join("")}` : ""}
    <details class="later"><summary>Kdy se co objeví</summary><ol class="tl">
      <li><b>Neděle 20:00 před termínem</b><span>Nedělní status. Dřív se pro termín nic nechystá.</span></li>
      <li><b>Po odeslání statusu až do začátku</b><span>Změny přihlášek se sčítají do jedné karty „Změny“.</span></li>
      <li><b>Začátek termínu</b><span>Neodeslaný status a změny k termínu zmizí.</span></li>
      <li><b>5 minut po konci</b><span>Platba za termín. Zůstane, dokud ji někdo neodešle, nejdéle do nedělního statusu na další termín.</span></li>
    </ol></details></div>`;
}
function renderSettings() {
  const admin = !!anyPin(), pend = superPin() && superData ? superData.groups.filter(g => g.status === "pending").length : 0;
  $("#s-settings").innerHTML = (admin ? `<a class="adminjump" href="#administrace"><span class="g" aria-hidden="true">⚙️</span><span><b>Administrace</b><small>${pend ? `${pend} ${plural(pend, "žádost", "žádosti", "žádostí")} o skupinu · ` : ""}nastavení skupiny</small></span><span class="go" aria-hidden="true">↓</span></a>` : "")
    + msgsPanel(admin)
    + (canSettings() ? `<div class="admzone" id="administrace"><div class="admhead"><span aria-hidden="true">⚙️</span><div><b>Administrace</b><small>vidí jen admin skupiny a správce aplikace</small></div>${admin ? `<a href="#top" class="up" aria-label="Nahoru">↑</a>` : ""}</div>${adminHtml()}</div>`
      : `<details class="adminlogin"><summary>Jsem admin</summary>${adminHtml()}</details>`);
}

// ---------- nastavení (admin) ----------
function adminHtml() {
  if (!anyPin()) return adminLoginPanel() + superLogin();
  return superPanel() + cfgGroupPanel() + cfgPricePanel() + cfgPrepayPanel() + cfgQrPanel() + cfgAdminPanel() + (superPin() ? "" : superLogin());
}
// Pole nastavení: změna se hned uloží (viz událost "change" a app_save_cfg).
const cfgLabel = (id, label, sub) => `<label for="cf-${id}">${label}${sub ? `<small>${sub}</small>` : ""}</label>`;
const cfgNum = (id, label, sub, val, unit, step = 1) => `<div class="field">${cfgLabel(id, label, sub)}
  <div class="unit"><input id="cf-${id}" type="number" inputmode="decimal" step="${step}" value="${esc(val)}" data-cf="${id}"><span>${unit}</span></div></div>`;
const cfgText = (id, label, val, sub = "", type = "text") => `<div class="field wide">${cfgLabel(id, label, sub)}
  <input id="cf-${id}" type="${type}" value="${esc(val)}" data-cf="${id}"></div>`;
const cfgSelect = (id, label, val, options) => `<div class="field wide"><label for="cf-${id}">${label}</label><select id="cf-${id}" data-cf="${id}">
  ${Object.entries(options).map(([k, name]) => `<option value="${k}" ${val === k ? "selected" : ""}>${name}</option>`).join("")}</select></div>`;
const cfgCost = (key, n, priceKey, priceLabel, sub) => { const x = C()[key]; return `<div class="field wide"><label>Položka ${n}<small>${sub}</small></label>
  <div class="costrow"><input value="${esc(x?.name)}" data-cf="${key}.name" aria-label="Název položky ${n}">
    <input type="number" value="${esc(x?.[priceKey])}" data-cf="${key}.${priceKey}" aria-label="${priceLabel}">
    <label class="sw"><input type="checkbox" data-cf="${key}.on" ${x?.on ? "checked" : ""}> zapnuto</label></div></div>`; };

function adminLoginPanel() {
  return `<div class="panel"><h2>Přihlášení admina</h2>
    <p class="sub">${D.group.has_pin ? "Zadejte PIN admina skupiny." : "Skupina ještě nemá PIN. Zvolte si ho (4–8 číslic), bude potřeba pro změny nastavení."}</p>
    <form id="pinForm" class="addform"><input id="pinIn" inputmode="numeric" autocomplete="off" pattern="[0-9]{4,8}" placeholder="PIN" aria-label="PIN" required>
      <button class="btn" type="submit">${D.group.has_pin ? "Přihlásit" : "Nastavit PIN"}</button></form>
    <p class="sub" style="margin:10px 0 0">Zapomenutý PIN obnoví správce aplikace.</p></div>`;
}
function cfgGroupPanel() {
  const c = C();
  return `<div class="panel"><h2>Skupina</h2>
    <div class="field wide"><label for="gname">Název</label><input id="gname" value="${esc(D.group.name)}" data-gname></div>
    ${cfgText("coach", "Trenér / organizátor", c.coach)}
    ${cfgText("place", "Místo", c.place)}${cfgText("season", "Sezóna", c.season, "zobrazí se v hlavičce")}
    ${c.type === "once" ? cfgText("date", "Datum", c.date, "", "date")
      : cfgText("dow", "Den v týdnu", c.dow) + cfgText("start", "První termín", c.start, "", "date") + cfgNum("weeks", "Počet termínů", "", c.weeks, "×")}
    ${cfgText("time", "Začátek", c.time, "", "time")}${cfgText("end", "Konec", c.end, "", "time")}
    ${cfgNum("cap", "Kapacita", "hráčů", c.cap, "os.")}
  </div>`;
}
function cfgPricePanel() {
  const c = C();
  return `<div class="panel"><h2>Ceny a rozpočítání</h2>
    ${cfgSelect("model", "Model plateb", c.model, { prepay: "Předplatné stálých + záskoky", equal: "Všichni rovným dílem" })}
    ${cfgCost("tr", 1, "price", "Cena položky 1", "název, cena za termín, zapnuto")}
    ${cfgCost("ct", 2, "hour", "Cena za hodinu", "název, cena za hodinu, zapnuto")}
    ${cfgNum("ct.hours", "Délka", "hodin", c.ct?.hours, "h", 0.5)}
    <div class="field"><label>Za termín<small>cena × délka</small></label><b class="num" style="text-align:right">${kc(court())}</b></div>
    ${cfgSelect("skin", "Vzhled", c.skin, { beach: "Beach", tenis: "Tenis", obecne: "Obecný" })}
  </div>`;
}
function cfgPrepayPanel() {
  const c = C();
  if (c.model !== "prepay") return "";
  const st = people().filter(p => p.g === "s"), paidN = st.filter(p => p.paid).length, terms = days().filter(inPrep).length;
  const need = terms * court(), fee = +c.prepay || 0;
  const amount = (sum, ok) => `<span class="${ok ? "paid" : "unpaid"}">${sum}</span>`;
  return `<div class="panel"><h2>Předplacené období</h2>
    <p class="sub">V tomto období stálí ${esc(ctName().toLowerCase())} neplatí, protože ho zaplatili dopředu. Mimo něj se dělí mezi všechny.</p>
    ${cfgText("prepFrom", "Od", c.prepFrom, "", "date")}${cfgText("prepTo", "Do", c.prepTo, "", "date")}
    ${cfgNum("prepay", "Předplatné na stálého", "za celé období", c.prepay, "Kč")}
    <div class="field"><label>Kontrola předplatného<small>${terms} termínů × ${kc(court())} = ${kc(need)}<br>${st.length} stálých × ${kc(fee)} = ${kc(st.length * fee)}</small></label>
      <b class="num" style="text-align:right">${amount(sign(st.length * fee - need), st.length * c.prepay >= need)}<br>
        <small style="color:var(--muted);font-weight:500">férově ${kc(st.length ? Math.ceil(need / st.length) : 0)}</small></b></div>
    <div class="field"><label>Skutečně zaplaceno<small>${paidN}/${st.length} stálých, chybí: ${st.filter(p => !p.paid).sort(byName).map(p => esc(p.n)).join(", ") || "nikdo"}</small></label>
      <b class="num" style="text-align:right">${amount(kc(paidN * fee), paidN * c.prepay >= need)}</b></div></div>`;
}
function cfgQrPanel() {
  return `<div class="panel"><h2>QR platba</h2>
    ${cfgText("iban", "Účet (IBAN)", C().iban, "bez mezer, např. CZ65…")}${cfgText("msg", "Zpráva pro příjemce", C().msg)}
  </div>`;
}
function cfgAdminPanel() {
  return `<div class="panel"><h2>Admin skupiny</h2><p class="sub">Skupina má jednoho admina, dalšího přidat nelze. Správce aplikace vidí vše.</p>
    <div class="field"><label>Admin</label><b style="text-align:right">${esc(P(D.group.admin_person)?.n || D.group.admin_name || "—")}</b></div>
    <form id="pinChange" class="addform" style="margin-top:8px"><input id="newPin" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="Nový PIN" aria-label="Nový PIN" required>
      <button class="btn small" type="submit">Změnit PIN</button></form>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn small ghost" data-copylink>Kopírovat odkaz skupiny</button>
      <button class="btn small ghost" data-logout>Odhlásit admina</button></div>
  </div>`;
}
function superLogin() {
  return `<details class="panel"><summary><b>Správce aplikace</b></summary>
    <form id="superForm" class="addform" style="margin-top:10px"><input id="superIn" inputmode="numeric" pattern="[0-9]{4,8}" placeholder="PIN správce" aria-label="PIN správce" required autocomplete="off"><button class="btn small" type="submit">Přihlásit</button></form>
    <p class="sub" style="margin:8px 0 0">Při úplně prvním přihlášení se zadaný PIN uloží jako PIN správce.</p></details>`;
}
function superPanel() {
  if (!superPin()) return "";
  if (!superData) { api("super_list", { p_pin: superPin() }).then(r => { if (r.ok) { superData = r; render(); } else { store.set("superpin", null); toast("PIN správce už neplatí."); render(); } }).catch(e => toast(e.message)); return `<div class="panel super"><p class="sub">Načítám přehled skupin…</p></div>`; }
  const pend = superData.groups.filter(g => g.status === "pending"), act = superData.groups.filter(g => g.status === "active");
  const base = location.origin + location.pathname;
  return `<div class="panel super"><h2>Správce aplikace</h2><p class="sub">Vidíte všechny skupiny a můžete v nich cokoli upravit.</p>
    <div class="field wide"><label for="superMail">Váš e-mail<small>pro budoucí upozornění na žádosti</small></label><input id="superMail" type="email" value="${esc(superData.email || "")}" placeholder="e-mail správce"></div>
    <h3>Žádosti o novou skupinu <span class="num">${pend.length}</span></h3>
    ${pend.length ? pend.map(g => `<div class="person"><div class="nm">${esc(g.name)}<small>žádá ${esc(g.admin_name)}${g.admin_email ? " · " + esc(g.admin_email) : ""} · ${g.cfg?.type === "once" ? "jednorázová akce" : "každý týden"}</small></div>
      <button class="btn small" data-appr="${esc(g.slug)}">Schválit</button><button class="btn small ghost" data-rej="${esc(g.slug)}">Zamítnout</button></div>`).join("") : `<p class="sub">Žádné čekající žádosti.</p>`}
    <h3>Všechny skupiny <span class="num">${act.length}</span></h3>
    ${act.map(g => `<div class="person"><div class="nm">${esc(g.name)}<small>admin: ${esc(g.admin_name || "—")}</small></div>
      <a class="btn small ghost" href="${base}?g=${encodeURIComponent(g.slug)}">Otevřít</a><button class="btn small ghost" data-reset="${esc(g.slug)}">Nový PIN</button></div>
      ${resetFor === g.slug ? `<form class="addform" data-resetform="${esc(g.slug)}"><input inputmode="numeric" pattern="[0-9]{4,8}" placeholder="Nový PIN admina" aria-label="Nový PIN admina" required><button class="btn small" type="submit">Uložit</button></form>` : ""}`).join("")}
    <button class="btn small ghost" data-superout style="margin-top:12px">Odhlásit správce</button></div>`;
}
let resetFor = null;

// ---------- založení skupiny ----------
function renderNew() {
  $("#s-new").innerHTML = `<div class="panel"><h2>Založit skupinu</h2>
    <p class="sub">Žádost schválí správce aplikace. Po odeslání dostanete odkaz na skupinu, který začne fungovat po schválení. Stanete se jejím adminem.</p>
    <form id="newGroup" class="stack">
      <div class="field wide"><label for="ng-n">Název</label><input id="ng-n" required maxlength="60" placeholder="např. Volejbal hala · středa"></div>
      <div class="field wide"><label for="ng-me">Vaše jméno</label><input id="ng-me" required maxlength="40"></div>
      <div class="field wide"><label>Typ termínů</label><div class="seg"><button type="button" class="ano" aria-pressed="${ngType === "week"}" data-ngt="week">Každý týden</button><button type="button" class="chci" aria-pressed="${ngType === "once"}" data-ngt="once">Jednorázová akce</button></div></div>
      ${ngType === "week" ? `<div class="field wide"><label for="ng-dow">Den v týdnu</label><select id="ng-dow">${["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"].map(x => `<option>${x}</option>`).join("")}</select></div>
      <div class="field wide"><label for="ng-start">První termín</label><input id="ng-start" type="date" required></div>
      <div class="field"><label for="ng-weeks">Počet termínů</label><input id="ng-weeks" type="number" value="16" min="1" max="60"></div>`
      : `<div class="field wide"><label for="ng-date">Datum</label><input id="ng-date" type="date" required></div>`}
      <div class="field"><label for="ng-time">Začátek</label><input id="ng-time" type="time" value="19:00"></div>
      <div class="field"><label for="ng-end">Konec</label><input id="ng-end" type="time" value="20:30"></div>
      <div class="field wide"><label for="ng-where">Místo</label><input id="ng-where" maxlength="60" placeholder="hala, kurt, adresa"></div>
      <div class="field"><label for="ng-cap">Kapacita</label><input id="ng-cap" type="number" value="12" min="1" max="200"></div>
      <div class="field wide"><label for="ng-model">Rozpočítání</label><select id="ng-model"><option value="prepay">Předplatné stálých + záskoky</option><option value="equal" selected>Všichni rovným dílem</option></select></div>
      <div class="field wide"><label>Položky nákladů<small>název, cena, zapnuto (druhá položka je cena za hodinu)</small></label>
        <div class="costrow"><input id="ng-trn" value="Trenér" aria-label="Název položky 1"><input id="ng-trp" type="number" value="0" aria-label="Cena položky 1"><label class="sw"><input id="ng-tro" type="checkbox"> zapnuto</label></div>
        <div class="costrow"><input id="ng-ctn" value="Kurt" aria-label="Název položky 2"><input id="ng-ctp" type="number" value="0" aria-label="Cena za hodinu"><label class="sw"><input id="ng-cto" type="checkbox" checked> zapnuto</label></div></div>
      <div class="field wide"><label for="ng-skin">Vzhled</label><select id="ng-skin"><option value="beach">Beach</option><option value="tenis">Tenis</option><option value="obecne" selected>Obecný</option></select></div>
      <div class="field wide"><label for="ng-mail">Váš e-mail<small>nepovinné, pro budoucí upozornění</small></label><input id="ng-mail" type="email" placeholder="vas@email.cz"></div>
      <div class="field"><label for="ng-pin">PIN admina<small>4–8 číslic</small></label><input id="ng-pin" inputmode="numeric" pattern="[0-9]{4,8}" required></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Odeslat žádost ke schválení</button><button class="btn ghost" type="button" data-cancelnew>Zpět</button></div>
    </form></div>`;
}

// ---------- události ----------
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b || (b.type === "submit" && b.closest("form"))) return;
  const ds = D?.group?.cfg ? days() : [];
  if (b.dataset.tab) { tab = b.dataset.tab; if (tab === "pay") payDay = ds[idx]; render(); scrollTo(0, 0); return; }
  if (b.id === "prev" && idx > 0) { idx--; render(); return; }
  if (b.id === "next" && idx < ds.length - 2) { idx++; render(); return; }
  if (b.id === "todayBtn") { idx = currentIdx(); render(); return; }
  if (b.dataset.iam) { store.set("me:" + slug, +b.dataset.iam); tab = "week"; render(); return; }
  if (b.dataset.v) {
    const d = b.dataset.d, pid = +b.dataset.p, v = b.dataset.v, cur = att[d]?.[pid]?.st, p = P(pid);
    const r = await act("app_set_status", { p_slug: slug, p_person: pid, p_day: d, p_status: cur === v ? null : v });
    if (r?.error === "full") toast(p.g === "z" ? "Plno. Klikni „Šel bych“, ať máš pořadí, až se uvolní místo." : "Plno. Místo už obsadil záskok, který potvrdil dřív.");
    else if (r?.error === "priority") toast(`Přednost má ${r.name}, klikl/a „šel bych“ dřív.`);
    else if (r?.ok && cur !== v && v === "ano" && p.g === "z") toast(`${p.n} jde hrát.`);
    return;
  }
  if (b.dataset.gopay) { payDay = b.dataset.gopay; tab = "pay"; render(); scrollTo(0, 0); return; }
  if (b.id === "copyAcc") { copy(C().iban, "Číslo účtu zkopírováno"); return; }
  if (b.hasAttribute("data-copylink")) { copy(location.origin + location.pathname + "?g=" + slug, "Odkaz zkopírován, pošlete ho skupině."); return; }
  if (b.dataset.ng) { addG = b.dataset.ng; render(); return; }
  if (b.dataset.ngt) { ngType = b.dataset.ngt; render(); return; }
  if (b.dataset.pick) { pickFor = pickFor === +b.dataset.pick ? null : +b.dataset.pick; render(); return; }
  if (b.dataset.face) { pickFor = null; await act("app_update_person", { p_slug: slug, p_person: +b.dataset.for, p_patch: { av: +b.dataset.face } }); return; }
  if (b.dataset.mail) { showMailForm(P(b.dataset.mail)); return; }
  if (b.dataset.askdel) { confirmDel = +b.dataset.askdel; render(); return; }
  if (b.hasAttribute("data-cancel")) { confirmDel = null; render(); return; }
  if (b.dataset.del) { const p = P(b.dataset.del); confirmDel = null; if (p.id == meId()) store.set("me:" + slug, null); await act("app_update_person", { p_slug: slug, p_person: p.id, p_patch: { active: false } }, `${p.n} odebrán(a). Historie zůstává.`); return; }
  if (b.dataset.move) { const p = P(b.dataset.move), g = p.g === "s" ? "z" : "s"; await act("app_update_person", { p_slug: slug, p_person: p.id, p_patch: { g } }, `${p.n} je teď ${g === "s" ? "stálý" : "záskok"}.`); return; }
  if (b.dataset.paid) { const p = P(b.dataset.paid); const r = await act("app_set_paid", { p_slug: slug, p_pin: anyPin(), p_person: p.id, p_paid: !p.paid }); if (r?.error === "pin") toast("Pro změnu předplatného se přihlaste jako admin v Nastavení."); return; }
  if (b.dataset.wasend || b.dataset.wacopy) { const [d, k] = (b.dataset.wasend || b.dataset.wacopy).split("|"), m = waCards().find(x => x.d === d && x.k === k); if (!m) return;
    if (b.dataset.wacopy) { copy(m.text, "Text zkopírován"); return; }
    window.open("https://wa.me/?text=" + encodeURIComponent(m.text), "_blank"); waConfirm = `${d}|${k}`; render(); return; }
  if (b.hasAttribute("data-wano")) { waConfirm = null; render(); return; }
  if (b.dataset.wayes || b.dataset.waign) { const [d, k] = (b.dataset.wayes || b.dataset.waign).split("|"), ign = !!b.dataset.waign; waConfirm = null;
    const r = await act("app_wa_mark", { p_slug: slug, p_day: d, p_kind: k, p_action: ign ? "ignored" : "sent", p_person: meId(), p_pin: ign ? anyPin() : null }, ign ? "Zpráva ignorována" : "Díky, odesláno");
    if (r?.error === "done") toast("Tuhle zprávu už mezitím odeslal někdo jiný."); else if (r?.error === "pin") toast("Ignorovat může jen admin.");
    return; }
  if (b.hasAttribute("data-goto-new")) { tab = "new"; render(); scrollTo(0, 0); return; }
  if (b.hasAttribute("data-cancelnew")) { tab = "week"; render(); return; }
  if (b.hasAttribute("data-logout")) { store.set("pin:" + slug, null); tab = "week"; render(); return; }
  if (b.hasAttribute("data-superout")) { store.set("superpin", null); superData = null; render(); return; }
  if (b.dataset.appr || b.dataset.rej) { const s = b.dataset.appr || b.dataset.rej; await act("super_decide", { p_pin: superPin(), p_slug: s, p_approve: !!b.dataset.appr }, b.dataset.appr ? "Schváleno. Pošlete zakladateli odkaz, nebo už ho má." : "Zamítnuto."); superData = null; render(); return; }
  if (b.dataset.reset) { resetFor = resetFor === b.dataset.reset ? null : b.dataset.reset; render(); return; }
});
function showMailForm(p) {
  const host = document.querySelector(`[data-mail="${p.id}"]`).parentElement;
  host.innerHTML = `<form class="mailform" data-mailform="${p.id}"><input type="email" required placeholder="e-mail" aria-label="E-mail pro ${esc(p.n)}"><button class="btn small" type="submit">Uložit</button></form>`;
  host.querySelector("input").focus();
}
function copy(text, ok) { (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(ok), () => toast(text)); }

document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "grp") { if (t.value === "__new") { tab = "new"; render(); scrollTo(0, 0); } else if (t.value && t.value !== slug) location.search = "?g=" + encodeURIComponent(t.value); return; }
  if (t.id === "me") { store.set("me:" + slug, +t.value); render(); return; }
  if (t.id === "payDay") { payDay = t.value; render(); return; }
  if (t.dataset.cash) { await act("app_set_cash", { p_slug: slug, p_day: t.dataset.cash, p_person: +t.value || null }); return; }
  if (t.id === "superMail") { await act("super_set_email", { p_pin: superPin(), p_email: t.value }, "Uloženo"); superData = null; render(); return; }
  if (t.dataset.cf || t.hasAttribute("data-gname")) {
    const cfg = JSON.parse(JSON.stringify(C()));
    if (t.dataset.cf) {
      const path = t.dataset.cf.split("."); let o = cfg; while (path.length > 1) { const k = path.shift(); o = o[k] ||= {}; }
      o[path[0]] = t.type === "checkbox" ? t.checked : t.type === "number" ? (t.value === "" ? 0 : +t.value) : t.value;
    }
    const r = await act("app_save_cfg", { p_slug: slug, p_pin: anyPin(), p_name: $("#gname")?.value || D.group.name, p_cfg: cfg, p_admin_email: null }, "Uloženo");
    if (r?.error === "pin") { store.set("pin:" + slug, null); toast("PIN už neplatí, přihlaste se znovu."); render(); }
  }
});

document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target;
  if (f.id === "addForm" || f.id === "joinForm") {
    const join = f.id === "joinForm", n = (join ? $("#joinName") : $("#newName")).value.trim(); if (!n) return;
    const r = await act("app_add_person", { p_slug: slug, p_name: n, p_kind: join ? "z" : addG, p_email: join ? null : $("#newMail").value.trim() || null }, join ? `Vítejte, ${n}!` : `${n} přidán(a).`);
    if (join && r?.ok) { store.set("me:" + slug, r.id); render(); }
    return;
  }
  if (f.dataset.mailform) { await act("app_update_person", { p_slug: slug, p_person: +f.dataset.mailform, p_patch: { email: f.querySelector("input").value.trim() } }, "E-mail uložen"); return; }
  if (f.id === "pinForm") {
    const pin = $("#pinIn").value.trim();
    try { const r = await api("app_admin_check", { p_slug: slug, p_pin: pin });
      if (r.ok) { if (r.super) store.set("superpin", pin); else store.set("pin:" + slug, pin); toast(r.created ? "PIN nastaven, jste přihlášen(a) jako admin." : "Přihlášeno"); await load(); render(); }
      else toast("Špatný PIN");
    } catch (err) { toast(err.message); }
    return;
  }
  if (f.id === "superForm") {
    const pin = $("#superIn").value.trim();
    try { const r = await api("super_check", { p_pin: pin });
      if (r.ok) { store.set("superpin", pin); superData = null; toast(r.created ? "PIN správce nastaven." : "Přihlášeno jako správce"); render(); } else toast("Špatný PIN správce");
    } catch (err) { toast(err.message); }
    return;
  }
  if (f.id === "pinChange") { const r = await act("app_change_pin", { p_slug: slug, p_pin: anyPin(), p_new: $("#newPin").value.trim() }, "PIN změněn"); if (r?.ok && adminPin()) store.set("pin:" + slug, $("#newPin").value.trim()); return; }
  if (f.dataset.resetform) { const s = f.dataset.resetform; await act("super_reset_pin", { p_pin: superPin(), p_slug: s, p_new: f.querySelector("input").value.trim() }, "PIN admina změněn. Sdělte mu ho."); resetFor = null; render(); return; }
  if (f.id === "newGroup") {
    const v = id => $("#" + id)?.value?.trim() || "";
    const cfg = { type: ngType, coach: "", place: v("ng-where"), season: "", time: v("ng-time"), end: v("ng-end"), cap: +v("ng-cap") || 12,
      model: v("ng-model"), tr: { name: v("ng-trn") || "Trenér", price: +v("ng-trp") || 0, on: $("#ng-tro").checked },
      ct: { name: v("ng-ctn") || "Kurt", hour: +v("ng-ctp") || 0, hours: 1.5, on: $("#ng-cto").checked },
      prepFrom: "", prepTo: "", prepay: 0, iban: "", msg: "", skin: v("ng-skin") };
    if (ngType === "week") Object.assign(cfg, { dow: v("ng-dow"), start: v("ng-start"), weeks: +v("ng-weeks") || 16, prepFrom: v("ng-start") });
    else cfg.date = v("ng-date");
    if (cfg.time && cfg.end) { const [a, b] = [cfg.time, cfg.end].map(x => +x.slice(0, 2) + +x.slice(3) / 60); if (b > a) cfg.ct.hours = Math.round((b - a) * 4) / 4; }
    try {
      const r = await api("app_request_group", { p_name: v("ng-n"), p_cfg: cfg, p_admin_name: v("ng-me"), p_admin_email: v("ng-mail") || null, p_pin: v("ng-pin") });
      rememberGroup(r.slug, v("ng-n"), "pending");
      location.search = "?g=" + encodeURIComponent(r.slug);
    } catch (err) { toast(err.message); }
  }
});

// ---------- start ----------
(async function init() {
  render();
  if (!slug) return;
  try { await load(); } catch (e) { D = null; $("#s-loading").innerHTML = `<div class="panel"><h2>Nepodařilo se načíst</h2><p class="sub">${esc(e.message)}</p></div>`; return; }
  if (D?.group?.status === "active") { const ds = days(), dl = ds.indexOf(new URLSearchParams(location.search).get("d")); idx = Math.min(dl >= 0 ? dl : currentIdx(), Math.max(0, ds.length - 2)); }
  render();
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
})();
