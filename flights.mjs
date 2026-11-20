// Passagens aéreas — menor preço de ida e volta saindo dos aeroportos perto de Rolândia.
//
// Fonte: API de dados da Travelpayouts (Aviasales), gratuita, em reais. Os preços são os
// que outras pessoas encontraram nas buscas das últimas 48 h — por isso o alerta sempre
// manda conferir no site antes de comprar.
//
// Variáveis de ambiente:
//   TRAVELPAYOUTS_TOKEN — chave grátis (travelpayouts.com > Ferramentas > API). Sem ela, a aba fica parada.
//   FLIGHT_ORIGINS=LDB,MGF — aeroportos de saída (padrão: Londrina e Maringá)

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN || "";
const ORIGINS = (process.env.FLIGHT_ORIGINS || "LDB,MGF").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

export const FLIGHT_RULES = {
  everyMin: 60, // a fonte só atualiza algumas vezes por dia: 1 consulta por hora basta
  months: 6, // mês atual + 5 seguintes
  dropVsUsual: 15, // % abaixo do preço de costume da rota naquele mês
  newLowMargin: 5, // % abaixo do menor preço já visto
  minHistoryDays: 3, // dias acompanhando a rota antes de avisar
  realertStep: 5, // só avisa de novo se cair mais 5% depois do último aviso
  keepDays: 2, // rota some do site se não aparecer por 2 dias
};

export const flightsEnabled = () => !!TOKEN;

const API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";

function monthsAhead(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}

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
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}

// Nomes das cidades e companhias (guardados no estado para não baixar toda hora)
async function fillNames(state, cities, airlines) {
  state.fnames ||= { c: {}, a: {} };
  const missC = [...cities].filter((c) => !state.fnames.c[c]);
  const missA = [...airlines].filter((a) => !state.fnames.a[a]);
  const pick = (x) => x.name || x.name_translations?.pt || x.name_translations?.en || x.code;
  if (missC.length) {
    try {
      const [cl, al] = await Promise.all([
        fetchJson("https://api.travelpayouts.com/data/pt/cities.json"),
        fetchJson("https://api.travelpayouts.com/data/pt/airports.json"),
      ]);
      const byCode = new Map(cl.map((x) => [x.code, x]));
      for (const a of al) if (!byCode.has(a.code) && a.city_code && byCode.has(a.city_code)) byCode.set(a.code, byCode.get(a.city_code));
      for (const c of missC) state.fnames.c[c] = byCode.has(c) ? pick(byCode.get(c)) : c;
    } catch (e) {
      console.log(`  passagens: nomes das cidades não carregaram (${e.message})`);
    }
  }
  if (missA.length) {
    try {
      const al = await fetchJson("https://api.travelpayouts.com/data/pt/airlines.json");
      const byCode = new Map(al.map((x) => [x.code, x]));
      for (const a of missA) state.fnames.a[a] = byCode.has(a) ? pick(byCode.get(a)) : a;
    } catch (e) {
      console.log(`  passagens: nomes das companhias não carregaram (${e.message})`);
    }
  }
}

export const cityName = (state, code) => state.fnames?.c?.[code] || code;
export const airlineName = (state, code) => state.fnames?.a?.[code] || code;

// Lê todas as rotas e devolve os alertas. state.flights[chave] = { o, d, m, p, dep, ret, air, tr, rtr, link, h, v, a, at }
export async function checkFlights({ state, nowDay, todayIso, usualPrice }) {
  if (!TOKEN) return { alerts: [], read: 0 };
  state.flights ||= {};
  const rows = [];
  for (const origin of ORIGINS) {
    for (const month of monthsAhead(FLIGHT_RULES.months)) {
      const q = new URLSearchParams({
        origin, departure_at: month, one_way: "false", currency: "brl", market: "br",
        sorting: "price", unique: "true", limit: "200", token: TOKEN,
      });
      const body = await fetchJson(`${API}?${q}`);
      for (const f of body?.data || []) rows.push(f);
      await new Promise((res) => setTimeout(res, 300));
    }
  }

  const alerts = [];
  const sentTrips = new Set();
  for (const f of rows) {
    const price = Math.round(Number(f.price));
    if (!price || !f.departure_at || f.departure_at.slice(0, 10) <= todayIso) continue;
    const dest = f.destination;
    const month = f.departure_at.slice(0, 7); // mês da ida (o que a viagem é, não o que foi pedido)
    const key = `${f.origin}-${dest}-${month}`;
    const r = (state.flights[key] ||= { o: f.origin, d: dest, m: month, h: [] });
    // várias viagens podem cair no mesmo mês/rota: fica a mais barata desta leitura
    if (r.v === nowDay && r.seenRun === state.runs && r.p <= price) continue;
    r.seenRun = state.runs;
    Object.assign(r, {
      oa: f.origin_airport, da: f.destination_airport,
      dep: f.departure_at, ret: f.return_at || "", air: f.airline || "", fn: f.flight_number || "",
      tr: f.transfers ?? 0, rtr: f.return_transfers ?? 0, link: f.link || "", v: nowDay,
    });
    const last = r.h[r.h.length - 1];
    const prevPrice = last ? last[1] : null;
    if (!last || last[1] !== price) {
      if (last && last[0] === nowDay) last[1] = price;
      else r.h.push([nowDay, price]);
      if (r.h.length > 120) r.h = r.h.slice(-120);
    }
    r.p = price;

    // ---------- avisa? ----------
    const firstDay = r.h[0][0];
    if (nowDay - firstDay < FLIGHT_RULES.minHistoryDays) continue;
    const before = r.h.slice(0, -1).map((x) => x[1]);
    if (!before.length) continue;
    const prevMin = Math.min(...before);
    const usual = usualPrice(r.h, nowDay);
    const reasons = [];
    if (usual && price <= usual * (1 - FLIGHT_RULES.dropVsUsual / 100))
      reasons.push(`${Math.round((1 - price / usual) * 100)}% abaixo do preço de costume da rota`);
    if (price <= prevMin * (1 - FLIGHT_RULES.newLowMargin / 100)) reasons.push("menor preço já visto nessa rota e mês");
    if (!reasons.length) {
      if (r.a && usual && price >= usual) r.a = null; // voltou ao normal: libera aviso futuro
      continue;
    }
    if (r.a && price > r.a * (1 - FLIGHT_RULES.realertStep / 100)) continue;
    const trip = `${r.o}|${r.d}|${r.dep}|${r.ret}`;
    if (sentTrips.has(trip)) continue;
    sentTrips.add(trip);
    r.a = price;
    r.at = todayIso;
    alerts.push({ key, ...r, price, prevPrice, usual, prevMin, reasons });
  }

  // limpa rotas antigas e meses que já passaram
  const thisMonth = todayIso.slice(0, 7);
  for (const [k, r] of Object.entries(state.flights)) {
    if (r.m < thisMonth || r.v < nowDay - 30) delete state.flights[k];
  }

  const cities = new Set(), airlines = new Set();
  for (const r of Object.values(state.flights)) { cities.add(r.o); cities.add(r.d); if (r.air) airlines.add(r.air); }
  await fillNames(state, cities, airlines);
  return { alerts, read: rows.length };
}

// ---------- links ----------
export const aviasalesUrl = (r) => (r.link ? `https://www.aviasales.com${r.link}` : `https://www.aviasales.com/search/${r.o}${r.dep.slice(8, 10)}${r.dep.slice(5, 7)}${r.d}1`);
export function googleFlightsUrl(r) {
  const q = `Voos de ${r.o} para ${r.d} em ${r.dep.slice(0, 10)}${r.ret ? ` voltando em ${r.ret.slice(0, 10)}` : ""}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}&hl=pt-BR&curr=BRL`;
}

const stops = (n) => (n ? `${n} ${n === 1 ? "escala" : "escalas"}` : "direto");
const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Lista para o site (aba Passagens)
export function exportFlights(state, nowDay) {
  return Object.values(state.flights || {})
    .filter((r) => r.v >= nowDay - FLIGHT_RULES.keepDays + 1 && r.p)
    .map((r) => {
      const prices = r.h.map((x) => x[1]);
      return {
        o: r.o, on: cityName(state, r.o), d: r.d, dn: cityName(state, r.d), m: r.m,
        p: r.p, dep: r.dep, ret: r.ret, al: airlineName(state, r.air), tr: r.tr, rtr: r.rtr,
        mn: Math.min(...prices), mx: Math.max(...prices), s: r.h[0][0], h: r.h.slice(-40),
        u: aviasalesUrl(r), g: googleFlightsUrl(r), ...(r.at ? { w: r.at, z: r.a } : {}),
      };
    })
    .sort((a, b) => a.p - b.p);
}

// Texto do alerta no Telegram (só fatos)
export function flightAlertText(state, a, { brl, esc }) {
  const from = `${cityName(state, a.o)} (${a.oa || a.o})`;
  const to = `${cityName(state, a.d)} (${a.da || a.d})`;
  const lines = [
    `✈️ <b>Passagem mais barata</b>`,
    `<b>${esc(from)} para ${esc(to)}</b>`,
    `Ida ${dmy(a.dep)}${a.ret ? ` · volta ${dmy(a.ret)}` : ""} · ida e volta, por pessoa`,
    ``,
    `💰 <b>${brl(a.price)}</b>`,
  ];
  if (a.usual && a.usual > a.price) lines.push(`Preço de costume: ${brl(a.usual)} (−${Math.round((1 - a.price / a.usual) * 100)}%)`);
  if (a.prevPrice && a.prevPrice !== a.price) lines.push(`Leitura anterior: ${brl(a.prevPrice)}`);
  lines.push(`Menor antes deste: ${brl(a.prevMin)}`);
  lines.push(`${esc(airlineName(state, a.air))} · ida ${stops(a.tr)}${a.ret ? ` · volta ${stops(a.rtr)}` : ""}`);
  lines.push(``, `Motivo: ${esc(a.reasons.join("; "))}.`);
  lines.push(`Preço encontrado em buscas das últimas 48 h; pode ter mudado. Confira antes de comprar.`);
  lines.push(``, `<a href="${esc(aviasalesUrl(a))}">Ver no Aviasales</a> · <a href="${esc(googleFlightsUrl(a))}">Conferir no Google Voos</a>`);
  return lines.join("\n");
}
