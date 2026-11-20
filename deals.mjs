// Promoções de passagem publicadas nos blogs Melhores Destinos e Passagens Imperdíveis.
// Eles já comparam com o preço normal, então servem de "termômetro" de passagem boa de verdade.
// Pedido do usuário (20/11/2026): "acho que to por fora dos preços".
//
// Melhores Destinos: feed RSS (10 últimas). Passagens Imperdíveis: sitemap.xml (com data) + título da página.
// Só promoções INTERNACIONAIS de passagem vão para o Telegram; destinos da lista dele vêm marcados.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export const DEAL_RULES = {
  everyMin: 15,
  maxPagesPerRun: 15, // páginas de promoção abertas por rodada (título e foto)
  firstRunHours: 24, // na 1ª vez, manda só o que saiu nas últimas 24 h
  keepDays: 30,
};

// Destinos da lista do usuário (Europa, Orlando, Bahamas, Roma/Itália)
const MINE = /europa|portugal|lisboa|porto\b|espanha|madri|barcelona|fran[cç]a|paris|it[aá]lia|roma|mil[aã]o|veneza|floren[cç]a|londres|inglaterra|reino unido|alemanha|frankfurt|munique|su[ií][cç]a|zurique|holanda|amsterd|[aá]ustria|viena|gr[eé]cia|atenas|praga|orlando|disney|bahamas|nassau/i;
const INTL = new RegExp(MINE.source + "|internacion|exterior|estados unidos|\\beua\\b|miami|nova york|new york|fort lauderdale|las vegas|los angeles|canad[aá]|toronto|caribe|canc[uú]n|punta cana|aruba|cura[cç]ao|rep[uú]blica dominicana|panam[aá]|chile|santiago|argentina|buenos aires|bariloche|mendoza|uruguai|montevid|punta del este|peru|lima|cusco|col[oô]mbia|bogot[aá]|cartagena|san andr[eé]s|m[eé]xico|jap[aã]o|t[oó]quio|dubai|emirados|egito|[aá]frica|[aá]sia|tail[aâ]ndia|irlanda|dublin|esc[oó]cia|cro[aá]cia|turquia|istambul|marrocos|israel|maldivas|austr[aá]lia|nova zel[aâ]ndia|china|coreia|[ií]ndia", "i");
const FLIGHT = /passage|voo|voos|a[eé]re|ida e volta|milhas/i;
const NOT_FLIGHT = /ingresso|parque|hotel|hospedagem|chip|seguro viagem|cruzeiro|aluguel de carro|montanha-russa|sorteio|sortear/i;
// bandeira de país (dois "regional indicators") que não seja a do Brasil
const FOREIGN_FLAG = /(?!\u{1F1E7}\u{1F1F7})[\u{1F1E6}-\u{1F1FF}]{2}/u;

const decode = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "").trim();
const tag = (xml, t) => decode((xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
const meta = (html, p) => decode((html.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`)) || [])[1]);

async function text(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).hostname}`);
  return r.text();
}

async function readMelhoresDestinos() {
  const xml = await text("https://www.melhoresdestinos.com.br/feed");
  return xml.split("<item>").slice(1).map((it) => ({
    src: "Melhores Destinos",
    url: tag(it, "link"),
    title: tag(it, "title"),
    desc: tag(it, "description"),
    at: Date.parse(tag(it, "pubDate")) || Date.now(),
    cat: /\/promocao\//.test(tag(it, "link")),
  }));
}

async function readPassagensImperdiveis() {
  const xml = await text("https://www.passagensimperdiveis.com.br/sitemap.xml");
  const out = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    if (!/\/promocao-/i.test(m[1])) continue; // só posts de promoção (as páginas fixas "passagens-para/cidade" ficam fora)
    out.push({ src: "Passagens Imperdíveis", url: m[1], at: Date.parse(m[2]) || 0, needPage: true });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 40);
}

const isIntlFlight = (d) => {
  const t = `${d.title} ${d.desc || ""}`;
  return FLIGHT.test(d.title) && !NOT_FLIGHT.test(d.title) && /R\$\s?[\d.]+/.test(t) && (FOREIGN_FLAG.test(d.title) || INTL.test(d.title));
};

// Devolve as promoções novas que valem aviso. state.deals = { seen: { url: dia }, init: true }
export async function checkDeals({ state, nowDay }) {
  state.deals ||= { seen: {}, init: false };
  const seen = state.deals.seen;
  const all = [];
  const errors = [];
  for (const [name, fn] of [["Melhores Destinos", readMelhoresDestinos], ["Passagens Imperdíveis", readPassagensImperdiveis]]) {
    try {
      all.push(...(await fn()));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  const fresh = all.filter((d) => d.url && !seen[d.url]);
  const first = !state.deals.init;
  const cutoff = Date.now() - DEAL_RULES.firstRunHours * 3600000;
  const out = [];
  let pages = 0;
  for (const d of fresh) {
    // 1ª vez: o que é antigo só fica marcado como visto
    if (first && d.at < cutoff) { seen[d.url] = nowDay; continue; }
    if (d.needPage || !d.image) {
      if (pages >= DEAL_RULES.maxPagesPerRun) continue; // fica para a próxima rodada
      pages++;
      try {
        const html = await text(d.url);
        d.title ||= meta(html, "og:title");
        d.desc ||= meta(html, "og:description") || meta(html, "description");
        d.image = meta(html, "og:image");
        const pub = Date.parse(meta(html, "article:published_time"));
        if (pub) d.at = pub;
      } catch (e) {
        errors.push(`${d.src}: ${e.message}`);
        continue;
      }
    }
    seen[d.url] = nowDay;
    if (first && d.at < cutoff) continue;
    if (!isIntlFlight(d)) continue;
    d.mine = MINE.test(d.title);
    out.push(d);
  }
  state.deals.init = true;
  for (const [u, day] of Object.entries(seen)) if (day < nowDay - DEAL_RULES.keepDays) delete seen[u];
  out.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || a.at - b.at);
  return { deals: out, read: all.length, errors };
}

export function dealCaption(d, { esc }) {
  const when = new Date(d.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const desc = (d.desc || "").replace(/\s+/g, " ").replace(/Promoção encontrada pelo Passagens Imperdíveis:.*$/i, "").trim();
  const lines = [
    `🗞️ <b>Promoção no ${esc(d.src)}</b> · ${when}`,
    ``,
    `<b>${esc(d.title)}</b>`,
  ];
  if (d.mine) lines.push(`⭐ Destino da sua lista`);
  if (desc) lines.push(``, esc(desc.length > 380 ? desc.slice(0, 377) + "…" : desc));
  lines.push(``, `<a href="${esc(d.url)}">Ver a promoção</a>`);
  return lines.join("\n").slice(0, 1024);
}
