// Passagens aéreas: ida e volta mais barata para Orlando, Bahamas, Roma e Europa,
// saindo de Londrina, Maringá, Curitiba e São Paulo (Guarulhos/Congonhas/Viracopos).
// Sem companhia low cost (Arajet, Ryanair, easyJet...). Azul e GOL entram.
//
// Fonte: API de dados da Travelpayouts (Aviasales), gratuita, em reais. Os preços são os
// que outras pessoas encontraram nas buscas das últimas 48 h, então o alerta sempre
// manda conferir antes de comprar. A fonte NÃO informa bagagem.
// Matrix ITA, Skyscanner, Booking e sites das companhias não têm API aberta e bloqueiam
// robô: entram só como links de conferência no alerta.
//
// Variáveis de ambiente:
//   TRAVELPAYOUTS_TOKEN: chave grátis (travelpayouts.com > Ferramentas > API). Sem ela, a aba fica parada.
//   FLIGHT_ORIGINS=LDB,MGF,CWB,SAO  (SAO = Guarulhos + Congonhas + Viracopos)
//   FLIGHT_DESTS=ORL,NAS,ROM,...    (códigos de cidade IATA)

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN || "";
// Lua de mel: Roma com ida em agosto de 2027 (destaque próprio, aviso mais sensível)
export const HONEYMOON = { month: "2027-08", dest: "ROM", drop: 5 };
const isHoneymoon = (r) => r.m === HONEYMOON.month && r.d === HONEYMOON.dest;
// Meses buscados: de agora até agosto/2027 (pelo menos 6 meses). Usuário: "não é só pra lua de mel"
function searchMonths() {
  if (process.env.FLIGHT_MONTHS) return process.env.FLIGHT_MONTHS.split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  const d = new Date();
  for (let i = 0; i < 24; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)).toISOString().slice(0, 7);
    if (i >= 6 && m > HONEYMOON.month) break;
    out.push(m);
  }
  return out;
}
const ORIGINS = (process.env.FLIGHT_ORIGINS || "LDB,MGF,CWB,SAO").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

// Destinos pedidos pelo usuário (20/11/2026): Orlando, Roma, Bahamas e Europa
export const DESTS = {
  ORL: { n: "Orlando", g: "Estados Unidos" },
  NAS: { n: "Nassau", g: "Bahamas" },
  ROM: { n: "Roma", g: "Europa" },
  LIS: { n: "Lisboa", g: "Europa" }, OPO: { n: "Porto", g: "Europa" },
  MAD: { n: "Madri", g: "Europa" }, BCN: { n: "Barcelona", g: "Europa" },
  PAR: { n: "Paris", g: "Europa" }, LON: { n: "Londres", g: "Europa" },
  MIL: { n: "Milão", g: "Europa" }, VCE: { n: "Veneza", g: "Europa" },
  AMS: { n: "Amsterdã", g: "Europa" }, FRA: { n: "Frankfurt", g: "Europa" },
  MUC: { n: "Munique", g: "Europa" }, ZRH: { n: "Zurique", g: "Europa" },
  VIE: { n: "Viena", g: "Europa" }, PRG: { n: "Praga", g: "Europa" }, ATH: { n: "Atenas", g: "Europa" },
};
const DEST_CODES = (process.env.FLIGHT_DESTS || Object.keys(DESTS).join(",")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

// Low cost: a própria fonte marca (is_lowcost). Estes entram na marra, caso a lista falhe.
// Arajet (DM) é low cost; Azul e GOL NÃO contam como low cost (pedido do usuário em 20/11/2026).
const NOT_LOWCOST = ["G3", "AD"];
const LOWCOST_EXTRA = ["DM", "FR", "U2", "W6", "VY", "NK", "F9", "B6", "H2", "JA", "HV", "TO", "EW", "V7", "DY", "D8", "N0", "FO", "WN", "G4", "XP", "LS"];

// Site de cada companhia (para conferir e comprar direto)
const AIRLINE_SITE = {
  LA: "https://www.latamairlines.com/br/pt", JJ: "https://www.latamairlines.com/br/pt", TP: "https://www.flytap.com/pt-br",
  IB: "https://www.iberia.com/br/", AF: "https://wwws.airfrance.com.br/", KL: "https://www.klm.com.br/",
  LH: "https://www.lufthansa.com/br/pt/homepage", AZ: "https://www.ita-airways.com/pt_br", BA: "https://www.britishairways.com/",
  LX: "https://www.swiss.com/br/pt/homepage", AA: "https://www.aa.com.br/", DL: "https://pt.delta.com/br/pt",
  UA: "https://www.united.com/pt/br/", CM: "https://www.copaair.com/pt-br/", AV: "https://www.avianca.com/br/pt/",
  UX: "https://www.aireuropa.com/br/pt/home", TK: "https://www.turkishairlines.com/pt-br/", EK: "https://www.emirates.com/br/portuguese/",
  QR: "https://www.qatarairways.com/pt-br/homepage.html", AR: "https://www.aerolineas.com.ar/pt-br", ET: "https://www.ethiopianairlines.com/br",
};

// Meta de preço por região (por pessoa, ida e volta): avisa na hora, sem esperar histórico.
// Europa a R$ 4.000: "to acostumado com passagem pra europa por 4000" (usuário, 20/11/2026)
// Orlando a R$ 2.500 (usuário, 20/11/2026). Por código de destino ou por região.
const TARGETS = { Europa: Number(process.env.FLIGHT_TARGET_EUROPA || 4000), ORL: Number(process.env.FLIGHT_TARGET_ORLANDO || 2500) };
const targetFor = (d) => TARGETS[d] ?? TARGETS[DESTS[d]?.g];

export const FLIGHT_RULES = {
  everyMin: 120, // ~720 consultas por varredura (10 meses): a cada 2 h
  dropVsUsual: 12, // % abaixo do preço de costume da rota naquele mês
  newLowMargin: 5, // % abaixo do menor preço já visto
  minHistoryDays: 3, // dias acompanhando a rota antes de avisar queda
  realertStep: 5, // só avisa de novo se cair mais 5% depois do último aviso
  keepDays: 2, // rota some do site se não aparecer por 2 dias
};

export const flightsEnabled = () => !!TOKEN;

const API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
      if (r.status === 401) throw Object.assign(new Error("chave da Travelpayouts recusada (401)"), { fatal: true });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (e.fatal || i === 2) throw e;
    }
    await sleep(3000 * (i + 1));
  }
}

const pick = (x) => x.name || x.name_translations?.pt || x.name_translations?.en || x.code;

// Lista de companhias (nome e se é low cost); guardada no estado por 7 dias
async function loadAirlines(state) {
  state.fair ||= { at: 0, low: [], names: {} };
  if (Date.now() - state.fair.at < 7 * 86400000 && state.fair.low.length) return;
  try {
    const al = await fetchJson("https://api.travelpayouts.com/data/pt/airlines.json");
    state.fair = { at: Date.now(), low: al.filter((a) => a.is_lowcost).map((a) => a.code), names: Object.fromEntries(al.map((a) => [a.code, pick(a)])) };
  } catch (e) {
    console.log(`  passagens: lista de companhias não carregou (${e.message})`);
  }
}
const isLowCost = (state, code) => !code || (!NOT_LOWCOST.includes(code) && (LOWCOST_EXTRA.includes(code) || (state.fair?.low || []).includes(code)));
export const airlineName = (state, code) => state.fair?.names?.[code] || code;

// Nomes das cidades de saída e aeroportos (Londrina, Guarulhos...)
const ORIGIN_NAME = { LDB: "Londrina", MGF: "Maringá", CWB: "Curitiba", SAO: "São Paulo", GRU: "Guarulhos", CGH: "Congonhas", VCP: "Campinas (Viracopos)" };
export const placeName = (code) => ORIGIN_NAME[code] || DESTS[code]?.n || code;

// Lê todas as rotas e devolve os alertas.
// state.flights[chave] = { o, oa, d, da, m, p, dep, ret, air, tr, rtr, dur, link, h, v, a, at }
export async function checkFlights({ state, nowDay, todayIso, usualPrice }) {
  if (!TOKEN) return { alerts: [], read: 0 };
  state.flights ||= {};
  await loadAirlines(state);

  // 1) varre todas as combinações; por rota e mês fica a viagem mais barata de companhia tradicional
  const best = new Map();
  let read = 0, lowSkipped = 0;
  for (const origin of ORIGINS) {
    for (const dest of DEST_CODES) {
      for (const month of searchMonths()) {
        const q = new URLSearchParams({
          origin, destination: dest, departure_at: month, one_way: "false", currency: "brl", market: "br",
          sorting: "price", unique: "false", limit: "100", token: TOKEN,
        });
        const body = await fetchJson(`${API}?${q}`);
        for (const f of body?.data || []) {
          read++;
          if (isLowCost(state, f.airline)) { lowSkipped++; continue; }
          const price = Math.round(Number(f.price));
          if (!price || !f.departure_at || f.departure_at.slice(0, 10) <= todayIso) continue;
          const key = `${origin}-${dest}-${f.departure_at.slice(0, 7)}`;
          if (!best.has(key) || price < best.get(key).price) best.set(key, { ...f, price, origin, dest });
        }
        await sleep(250);
      }
    }
  }

  // 2) histórico e alertas
  const alerts = [];
  for (const [key, f] of best) {
    const r = (state.flights[key] ||= { o: f.origin, d: f.dest, m: f.departure_at.slice(0, 7), h: [] });
    Object.assign(r, {
      oa: f.origin_airport || f.origin, da: f.destination_airport || f.dest,
      dep: f.departure_at, ret: f.return_at || "", air: f.airline || "", fn: f.flight_number || "",
      tr: f.transfers ?? 0, rtr: f.return_transfers ?? 0, dur: f.duration_to || 0, durb: f.duration_back || 0,
      link: f.link || "", v: nowDay,
    });
    const price = f.price;
    const last = r.h[r.h.length - 1];
    const prevPrice = last ? last[1] : null;
    if (!last || last[1] !== price) {
      if (last && last[0] === nowDay) last[1] = price;
      else r.h.push([nowDay, price]);
      if (r.h.length > 120) r.h = r.h.slice(-120);
    }
    r.p = price;

    const target = targetFor(r.d);
    const lm = isHoneymoon(r);
    const hitTarget = target && price <= target;
    if (!hitTarget && nowDay - r.h[0][0] < FLIGHT_RULES.minHistoryDays) continue;
    const before = r.h.slice(0, -1).map((x) => x[1]);
    if (!before.length && !hitTarget) continue;
    const prevMin = before.length ? Math.min(...before) : price;
    const usual = usualPrice(r.h, nowDay);
    const reasons = [];
    if (hitTarget) reasons.push(`dentro da sua meta para ${TARGETS[r.d] ? DESTS[r.d].n : `a ${DESTS[r.d].g}`} (até R$ ${target.toLocaleString("pt-BR")} por pessoa)`);
    if (usual && price <= usual * (1 - (lm ? HONEYMOON.drop : FLIGHT_RULES.dropVsUsual) / 100))
      reasons.push(`${Math.round((1 - price / usual) * 100)}% abaixo do preço de costume da rota`);
    if (before.length && price <= prevMin * (1 - FLIGHT_RULES.newLowMargin / 100)) reasons.push("menor preço já visto nessa rota e mês");
    if (!reasons.length) {
      if (r.a && usual && price >= usual) r.a = null; // voltou ao normal: libera aviso futuro
      continue;
    }
    if (r.a && price > r.a * (1 - FLIGHT_RULES.realertStep / 100)) continue;
    r.a = price;
    r.at = todayIso;
    alerts.push({ key, ...r, lm, price, prevPrice, usual, prevMin, reasons });
  }

  // limpa meses que já passaram e rotas sumidas
  const thisMonth = todayIso.slice(0, 7);
  for (const [k, r] of Object.entries(state.flights)) if (r.m < thisMonth || r.v < nowDay - 30) delete state.flights[k];

  console.log(`  passagens: ${read} viagens lidas, ${lowSkipped} de low cost descartadas, ${best.size} rotas/mês`);
  return { alerts, read: best.size };
}

// ---------- links ----------
const ymd = (iso) => (iso || "").slice(0, 10);
const yymmdd = (iso) => (iso || "").slice(2, 10).replace(/-/g, "");
export const aviasalesUrl = (r) => (r.link ? `https://www.aviasales.com${r.link}` : "https://www.aviasales.com/");
export const googleFlightsUrl = (r) =>
  `https://www.google.com/travel/flights?q=${encodeURIComponent(`Voos de ${r.oa || r.o} para ${r.da || r.d} em ${ymd(r.dep)}${r.ret ? ` voltando em ${ymd(r.ret)}` : ""}`)}&hl=pt-BR&curr=BRL`;
export const skyscannerUrl = (r) =>
  `https://www.skyscanner.com.br/transporte/voos/${(r.oa || r.o).toLowerCase()}/${(r.da || r.d).toLowerCase()}/${yymmdd(r.dep)}/${r.ret ? `${yymmdd(r.ret)}/` : ""}`;
export const kayakUrl = (r) => `https://www.kayak.com.br/flights/${r.oa || r.o}-${r.da || r.d}/${ymd(r.dep)}${r.ret ? `/${ymd(r.ret)}` : ""}?sort=price_a`;
export const bookingUrl = () => "https://flights.booking.com/";
export const matrixUrl = () => "https://matrix.itasoftware.com/";
export const airlineUrl = (r) => AIRLINE_SITE[r.air] || "";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const stops = (n) => (n ? `${n} ${n === 1 ? "escala" : "escalas"}` : "direto");
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "");
const hm = (min) => (min ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : "");
const nights = (r) => (r.ret ? Math.round((Date.parse(ymd(r.ret)) - Date.parse(ymd(r.dep))) / 86400000) : 0);

// Lista para o site (aba Passagens)
export function exportFlights(state, nowDay) {
  return Object.values(state.flights || {})
    .filter((r) => r.v >= nowDay - FLIGHT_RULES.keepDays + 1 && r.p)
    .map((r) => {
      const prices = r.h.map((x) => x[1]);
      return {
        o: r.oa || r.o, on: placeName(r.oa || r.o), d: r.da || r.d, dn: DESTS[r.d]?.n || r.d, dg: DESTS[r.d]?.g || "", m: r.m,
        p: r.p, dep: r.dep, ret: r.ret, al: airlineName(state, r.air), tr: r.tr, rtr: r.rtr, du: r.dur, db: r.durb,
        mn: Math.min(...prices), mx: Math.max(...prices), s: r.h[0][0], h: r.h.slice(-40),
        ...(isHoneymoon(r) ? { lm: 1 } : {}),
        u: aviasalesUrl(r), g: googleFlightsUrl(r), k: skyscannerUrl(r), y: kayakUrl(r), c: airlineUrl(r),
        ...(r.at ? { w: r.at, z: r.a } : {}),
      };
    })
    .sort((a, b) => a.p - b.p);
}

// Texto do alerta no Telegram (só fatos)
export function flightAlertText(state, a, { brl, esc }) {
  const from = `${placeName(a.oa || a.o)} (${a.oa || a.o})`;
  const to = `${DESTS[a.d]?.n || a.d} (${a.da || a.d})`;
  const n = nights(a);
  const lines = [
    a.lm ? `💍 <b>Lua de mel: Roma em agosto</b>` : `✈️ <b>Passagem mais barata: ${esc(DESTS[a.d]?.n || a.d)}</b>`,
    `<b>${esc(from)} para ${esc(to)}</b>`,
    `Ida ${dmy(a.dep)}${a.ret ? ` · volta ${dmy(a.ret)} (${n} ${n === 1 ? "noite" : "noites"})` : ""}`,
    ``,
    `💰 <b>${brl(a.price)}</b> ida e volta, por pessoa, classe econômica`,
    `👫 Casal: ${brl(a.price * 2)}`,
  ];
  if (a.usual && a.usual > a.price) lines.push(`Preço de costume: ${brl(a.usual)} (−${Math.round((1 - a.price / a.usual) * 100)}%)`);
  if (a.prevPrice && a.prevPrice !== a.price) lines.push(`Leitura anterior: ${brl(a.prevPrice)}`);
  if (a.prevMin !== a.price) lines.push(`Menor antes deste: ${brl(a.prevMin)}`);
  lines.push(``, `🛫 <b>${esc(airlineName(state, a.air))}</b>${a.fn ? ` (voo ${esc(a.air)} ${esc(a.fn)})` : ""}`);
  lines.push(`Ida: ${stops(a.tr)}${a.dur ? `, ${hm(a.dur)}` : ""}`);
  if (a.ret) lines.push(`Volta: ${stops(a.rtr)}${a.durb ? `, ${hm(a.durb)}` : ""}`);
  lines.push(`🧳 Bagagem: a fonte não informa. Confira se a tarifa inclui mala despachada antes de pagar.`);
  lines.push(``, `Motivo: ${esc(a.reasons.join("; "))}.`);
  lines.push(`Preço encontrado em buscas das últimas 48 h; pode ter mudado.`);
  const links = [
    [aviasalesUrl(a), "Aviasales"], [googleFlightsUrl(a), "Google Voos"], [skyscannerUrl(a), "Skyscanner"],
    [kayakUrl(a), "Kayak"], [airlineUrl(a), `Site ${airlineName(state, a.air)}`], [bookingUrl(), "Booking"], [matrixUrl(), "Matrix ITA"],
  ].filter((x) => x[0]);
  lines.push(``, `Conferir: ${links.map(([u, t]) => `<a href="${esc(u)}">${esc(t)}</a>`).join(" · ")}`);
  return lines.join("\n");
}

// Primeira mensagem: o preço de hoje para cada destino (vira a base dos alertas)
export function flightBaselineText(state, { brl, esc }) {
  const best = new Map();
  for (const r of Object.values(state.flights || {})) if (!best.has(r.d) || best.get(r.d).p > r.p) best.set(r.d, r);
  const rows = [...best.values()].sort((a, b) => a.p - b.p);
  if (!rows.length) return "";
  const lmRow = Object.values(state.flights).filter(isHoneymoon).sort((a, b) => a.p - b.p)[0];
  return [
    `✈️ <b>Passagens ligadas</b>`,
    `Ida e volta mais barata hoje por pessoa (até agosto de 2027), sem low cost, saindo de ${esc(ORIGINS.map(placeName).join(", "))}:`,
    ...(lmRow ? [``, `💍 <b>Lua de mel (Roma, agosto/27)</b>: ${brl(lmRow.p)} · ${esc(airlineName(state, lmRow.air))} · saindo de ${esc(placeName(lmRow.oa || lmRow.o))} · ida ${dmy(lmRow.dep)}${lmRow.ret ? ` volta ${dmy(lmRow.ret)}` : ""}`] : [``, `💍 Lua de mel (Roma, agosto/27): ainda sem preço na fonte.`]),
    ``,
    ...rows.map((r) => `• <b>${esc(DESTS[r.d]?.n || r.d)}</b> (${MES[+r.m.slice(5, 7) - 1]}/${r.m.slice(2, 4)}): ${brl(r.p)} · ${esc(airlineName(state, r.air))} · saindo de ${esc(placeName(r.oa || r.o))} · ida ${dmy(r.dep)}`),
    ``,
    `Daqui pra frente aviso quando uma rota cair ${FLIGHT_RULES.dropVsUsual}% abaixo do preço de costume, bater o menor preço já visto, a Europa sair por até R$ ${TARGETS.Europa.toLocaleString("pt-BR")} ou Orlando por até R$ ${TARGETS.ORL.toLocaleString("pt-BR")}. Roma em agosto avisa a partir de ${HONEYMOON.drop}% de queda. Bagagem não vem da fonte: confira na tarifa.`,
  ].join("\n");
}
