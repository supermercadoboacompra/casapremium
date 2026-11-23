// Promoções de passagem publicadas nos blogs Melhores Destinos e Passagens Imperdíveis.
// Eles já comparam com o preço normal, então servem de "termômetro" de passagem boa de verdade.
// Pedido do usuário (20/11/2026): "acho que to por fora dos preços".
//
// Melhores Destinos: feed RSS (10 últimas). Passagens Imperdíveis: sitemap.xml (com data) + título da página.
// Só promoções de passagem para FORA do Brasil e abaixo do teto de preço da região (REGIONS) vão para o Telegram.
// Pedido (20/11): "n quero promo do brasil, quero só pra fora e só promo boa". Destinos da lista dele vêm marcados.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export const DEAL_RULES = {
  everyMin: 15,
  maxPagesPerRun: 15, // páginas de promoção abertas por rodada (título e foto)
  firstRunHours: 24, // na 1ª vez, manda só o que saiu nas últimas 24 h
  keepDays: 30,
};

// Palavra inteira (com acento): "porto" não pode pegar "Porto Seguro" nem "Aeroporto", "lima" não pega "Limeira".
const words = (src) => new RegExp(`(?<!\\p{L})(?:${src})(?!\\p{L})`, "iu");

// Destinos da lista do usuário (Europa, Orlando, Bahamas, Roma/Itália)
const MINE_SRC = "europa|portugal|lisboa|porto(?! seguro| alegre| de galinhas| velho| belo)|espanha|madri|barcelona|fran[cç]a|paris|it[aá]lia|roma|mil[aã]o|veneza|floren[cç]a|londres|inglaterra|reino unido|alemanha|frankfurt|munique|su[ií][cç]a|zurique|holanda|amsterd[aã]|[aá]ustria|viena|gr[eé]cia|atenas|praga|orlando|disney|bahamas|nassau";
const MINE = words(MINE_SRC);

// Promo boa = "a partir de" do título abaixo do teto da região (ida e volta, por pessoa, com taxas).
// Europa, Orlando e EUA seguem as metas dele (R$ 4.000, R$ 3.000 e R$ 2.500); acima disso o blog chama de promoção, mas não é.
// Título sem destino de fora reconhecido = fica de fora (era assim que promo do Brasil escapava).
export const REGIONS = [
  { name: "Europa", max: 4000, re: words(MINE_SRC.replace("|orlando|disney|bahamas|nassau", "") + "|irlanda|dublin|esc[oó]cia|edimburgo|cro[aá]cia|b[eé]lgica|bruxelas|dinamarca|copenhague|noruega|su[eé]cia|finl[aâ]ndia|pol[oô]nia|hungria|budapeste|turquia|istambul") },
  { name: "Orlando", max: 3000, re: words("orlando|disney|mco") },
  { name: "EUA, Canadá, México e Caribe", max: 2500, re: words("bahamas|nassau|estados unidos|eua|miami|fort lauderdale|nova york|new york|boston|chicago|atlanta|dallas|houston|las vegas|los angeles|san francisco|washington|canad[aá]|toronto|montreal|vancouver|quebec|m[eé]xico|canc[uú]n|caribe|punta cana|rep[uú]blica dominicana|aruba|cura[cç]ao|jamaica|cuba|panam[aá]|costa rica") },
  { name: "América do Sul", max: 1200, re: words("chile|santiago|argentina|buenos aires|bariloche|mendoza|ushuaia|uruguai|montevid[eé]u|punta del este|peru|lima|cusco|col[oô]mbia|bogot[aá]|cartagena|medell[ií]n|san andr[eé]s|santa marta|equador|quito|bol[ií]via|paraguai|assun[cç][aã]o|atacama|calama") },
  { name: "Ásia, África e Oceania", max: 5000, re: words("jap[aã]o|t[oó]quio|tokyo|osaka|coreia|seul|china|xangai|pequim|tail[aâ]ndia|bangkok|dubai|emirados|catar|doha|egito|cairo|[aá]frica|marrocos|israel|maldivas|[ií]ndia|austr[aá]lia|sydney|nova zel[aâ]ndia|singapura|vietn[aã]|bali|indon[eé]sia") },
];
// Promoção de companhia low cost fica de fora (usuário, 23/11: "ryanair é lowcost")
const LOWCOST = /ryanair|easyjet|easy jet|vueling|wizz ?air|arajet|jetsmart|jet smart|flybondi|sky airline|norse|level|spirit|frontier|transavia|eurowings|volotea|pegasus|flynas|air arabia|flydubai/i;
const FLIGHT = /passage|voo|voos|a[eé]re|ida e volta/i;
const NOT_FLIGHT = /ingresso|parque|hotel|hospedagem|chip|seguro viagem|cruzeiro|aluguel de carro|montanha-russa|sorteio|sortear|milhas|pontos|taxa de/i;

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

// Menor "R$ X" do título (é o "a partir de").
const priceOf = (t) => {
  const v = [...String(t).matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g)].map((m) => +m[1].replace(/\./g, ""));
  return v.length ? Math.min(...v) : 0;
};

// Só passagem para FORA do Brasil e com preço abaixo do teto da região; senão devolve null.
export const judgeDeal = (d) => {
  const t = d.title || "";
  if (!FLIGHT.test(t) || NOT_FLIGHT.test(t) || LOWCOST.test(t + " " + (d.desc || ""))) return null;
  const region = REGIONS.find((r) => r.re.test(t));
  if (!region) return null;
  const price = priceOf(t);
  if (!price || price > region.max) return null;
  return { region: region.name, max: region.max, price };
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
    const ok = judgeDeal(d);
    if (!ok) continue;
    Object.assign(d, ok);
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
  const brl = (v) => "R$ " + v.toLocaleString("pt-BR");
  // título do blog sem o preço e sem "Promoção:" no começo (o preço vem numa linha própria)
  const title = String(d.title || "")
    .replace(/^\s*(promo[cç][aã]o|promo|imperd[ií]vel|urgente)\s*[:!\-–—|]\s*/i, "")
    .replace(/\s*[-–—:|,]?\s*(a partir de|por|desde)?\s*R\$\s?[\d.]+(,\d{2})?.*$/i, "")
    .trim().replace(/^./, (c) => c.toUpperCase()) || d.title;
  const desc = (d.desc || "").replace(/\s+/g, " ").replace(/Promoção encontrada pelo Passagens Imperdíveis:.*$/i, "").trim();
  const lines = [`✈️ <b>${esc(title)}</b>`, ``];
  if (d.price) {
    lines.push(`💰 A partir de <b>${brl(d.price)}</b> por pessoa, ida e volta`);
    lines.push(`👫 Casal: ${brl(d.price * 2)}`);
    const gap = d.max - d.price;
    lines.push(gap > 0 ? `🎯 ${brl(gap)} abaixo da sua meta para ${esc(d.region)} (${brl(d.max)})` : `🎯 No limite da sua meta para ${esc(d.region)} (${brl(d.max)})`);
  }
  if (d.mine) lines.push(`⭐ Destino da sua lista`);
  if (desc) lines.push(``, esc(desc.length > 260 ? desc.slice(0, 257).replace(/\s+\S*$/, "") + "…" : desc));
  lines.push(``, `🗞️ ${esc(d.src)} · ${when}`, `Link: ${esc(d.url)}`);
  return lines.join("\n").slice(0, 1024);
}
