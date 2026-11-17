// Casa Premium — monitora o catálogo inteiro de lojas oficiais brasileiras
// e avisa no Telegram quando um produto cai de preço de verdade.
//
// Variáveis de ambiente:
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  — obrigatórias para enviar
//   TEST_ONLY=true   — só manda uma mensagem de teste e sai
//   DRY_RUN=true     — consulta as lojas mas não envia nada (mostra no log)
//   ONLY=smeg,karsten — consulta só essas lojas (para testes)

import fs from "node:fs";
import zlib from "node:zlib";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TEST_ONLY = process.env.TEST_ONLY === "true";
const DRY_RUN = process.env.DRY_RUN === "true" || !TOKEN || !CHAT_ID;
const FORCE_DIGEST = process.env.DIGEST === "true"; // manda o resumo do dia agora
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const STATE_FILE = "state.json.gz";
const EXTRA_CSV = "products.csv";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// ---------- regras do alerta (ajuste aqui) ----------
const RULES = {
  dropVsUsual: 15, // % abaixo do preço "de costume" dos últimos 30 dias
  newLowMargin: 5, // % abaixo do menor preço já visto
  minHistoryDays: 3, // dias de histórico antes de considerar "menor preço"
  realertStep: 3, // só avisa de novo se cair mais 3% depois do último aviso
  maxSinglePerRun: 12, // alertas individuais por rodada; o resto vai num resumo
  usualWindowDays: 30,
  minPrice: 100, // ignora peças e acessórios baratos (parafusos, gaxetas...)
  dropVsLast: 10, // % de queda desde a consulta anterior (avisa na hora, mesmo sem histórico longo)
  heavyEveryMin: 60, // lojas lentas (muitas páginas) são lidas no máximo 1x por hora
  couponsEveryMin: 60, // procura cupons nos sites 1x por hora
};

// ---------- lojas ----------
const STORES = [
  { id: "lecreuset", name: "Le Creuset", type: "sfcc", brand: "Le Creuset",
    url: "https://www.lecreuset.com.br/on/demandware.store/Sites-LeCreuset_BR-Site/pt_BR/Search-UpdateGrid?cgid=root&start=0&sz=1000",
    base: "https://www.lecreuset.com.br",
    variation: "https://www.lecreuset.com.br/on/demandware.store/Sites-LeCreuset_BR-Site/pt_BR/Product-Variation",
    colors: ["Thyme"] }, // cores anotadas: cada peça nessa cor é acompanhada separado
  { id: "smeg", name: "Smeg Brasil", type: "magazord", brand: "Smeg", heavy: true, home: "https://www.smegbrasil.com.br",
    sitemap: "https://www.smegbrasil.com.br/sitemap-produto.xml" },
  { id: "kitchenaid", name: "KitchenAid", type: "vtex", host: "https://www.kitchenaid.com.br" },
  { id: "karsten", name: "Karsten", type: "vtex", host: "https://www.karsten.com.br" },
  { id: "trussardi", name: "Trussardi", type: "vtex", host: "https://www.trussardi.com.br" },
  { id: "casaalmeida", name: "Casa Almeida", type: "wake", brand: "Buddemeyer", home: "https://www.casaalmeida.com.br",
    search: "https://www.casaalmeida.com.br/busca?q=buddemeyer" },
  // multimarcas: só os produtos das marcas abaixo
  { id: "americanas", name: "Americanas", type: "vtexBrands", host: "https://www.americanas.com.br" },
  { id: "spicy", name: "Spicy", type: "vtexBrands", host: "https://www.spicy.com.br" },
  { id: "letseatit", name: "Lets Eat It", type: "shopify", host: "https://letseatit.com.br" },
  { id: "cookstore", name: "Cook Store", type: "woo", host: "https://cookstore.com.br", brands: ["Le Creuset"] },
];

const BRANDS = ["Le Creuset", "Smeg", "KitchenAid", "Karsten", "Trussardi", "Buddemeyer"];

// Anotações: destacam peças de interesse no alerta e furam a fila do resumo.
const NOTES = [
  { label: "🌿 Cor Thyme", match: (r) => /creuset/i.test(r.brand) && /thyme|tomilho/i.test(`${r.name} ${r.url}`) },
];

// ---------- utilidades ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const dayNum = (iso) => Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);

async function get(url, { json = false, tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9" },
        signal: AbortSignal.timeout(60000),
      });
      if (r.status === 206 || r.ok) return { body: json ? await r.json() : await r.text(), headers: r.headers };
      last = new Error(`HTTP ${r.status}`);
      if (r.status === 404) break;
    } catch (e) {
      last = e;
    }
    await sleep(2000 * (i + 1));
  }
  throw last;
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx]);
        } catch (e) {
          out[idx] = null;
        }
        await sleep(400);
      }
    })
  );
  return out;
}

const ENT = { quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", ordm: "º", ordf: "ª", deg: "°" };
const ACC = { acute: "́", grave: "̀", tilde: "̃", circ: "̂", cedil: "̧", uml: "̈" };
const decodeHtml = (s) => {
  for (let i = 0; i < 2; i++) // duas vezes: alguns sites mandam "&amp;ccedil;"
    s = s.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      if (ENT[e]) return ENT[e];
      const k = Object.keys(ACC).find((a) => e.length === a.length + 1 && e.endsWith(a));
      return k ? (e[0] + ACC[k]).normalize("NFC") : m;
    });
  return s;
};

const num = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? v : null;
  let s = String(v).replace(/[^\d,.]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return n > 0 ? n : null;
};

function* ldJson(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      yield JSON.parse(m[1]);
    } catch {}
  }
}

function findProduct(node) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findProduct(n);
      if (r) return r;
    }
  } else if (node && typeof node === "object") {
    const t = [].concat(node["@type"] || []);
    if (t.includes("Product")) {
      const offers = [].concat(node.offers || []);
      const o = offers[0] || {};
      const price = num(o.price ?? o.lowPrice);
      if (price) {
        return {
          name: node.name,
          image: [].concat(node.image || [])[0],
          price,
          available: !/OutOfStock|SoldOut/i.test(o.availability || ""),
        };
      }
    }
    for (const v of Object.values(node)) {
      const r = findProduct(v);
      if (r) return r;
    }
  }
  return null;
}

// ---------- leitores por plataforma ----------
// Cada leitor devolve [{ key, brand, name, url, image, price, listPrice, available }]

// Lojas multimarcas (Americanas): busca marca por marca e fica só com o que é da marca mesmo.
async function readVtexBrands(store) {
  const out = new Map();
  for (const brand of BRANDS) {
    const rows = await readVtex({ ...store, ft: brand, keepBrand: brand });
    for (const r of rows) out.set(r.key, r);
  }
  return [...out.values()];
}

async function readVtex(store) {
  const api = `${store.host}/api/catalog_system/pub/products/search`;
  const ft = store.ft ? `ft=${encodeURIComponent(store.ft)}&` : "";
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const head = await get(`${api}?${ft}_from=0&_to=0`);
  const total = parseInt((head.headers.get("resources") || "").split("/")[1] || "0", 10);
  // A VTEX só deixa paginar até 2.500. Se passar disso, lê o resto pela ordem inversa de preço.
  const ranges = [];
  for (let f = 0; f < Math.min(total, 2500); f += 50) ranges.push(["OrderByPriceASC", f]);
  for (let f = 0; f < Math.max(0, total - 2500) + 50; f += 50) if (total > 2500) ranges.push(["OrderByPriceDESC", f]);

  const pages = await pool(ranges, 3, async ([order, f]) =>
    (await get(`${api}?${ft}O=${order}&_from=${f}&_to=${Math.min(f + 49, 2549)}`, { json: true })).body
  );
  const out = new Map();
  for (const page of pages) {
    for (const p of page || []) {
      if (store.keepBrand && !norm(p.brand).includes(norm(store.keepBrand))) continue;
      for (const it of p.items || []) {
        // menor preço entre os vendedores com estoque
        const offer = (it.sellers || [])
          .map((s) => s.commertialOffer)
          .filter((o) => o && o.Price > 0 && o.AvailableQuantity > 0)
          .sort((a, b) => a.Price - b.Price)[0];
        if (!offer) continue;
        // preço no Pix (à vista), quando a loja informa
        const pix = Math.min(
          ...(offer.Installments || [])
            .filter((x) => /pix/i.test(x.PaymentSystemName) && x.NumberOfInstallments === 1)
            .map((x) => x.Value)
        );
        const sku = it.name && it.name !== p.productName && !p.productName.includes(it.name) ? ` — ${it.name}` : "";
        out.set(`${store.id}:${it.itemId}`, {
          key: `${store.id}:${it.itemId}`,
          brand: p.brand || store.name,
          name: p.productName + sku,
          url: p.link,
          image: it.images?.[0]?.imageUrl,
          price: offer.Price,
          listPrice: offer.ListPrice > offer.Price ? offer.ListPrice : null,
          pix: pix > 0 && pix < offer.Price ? pix : null,
          available: offer.AvailableQuantity > 0,
        });
      }
    }
  }
  if (total && out.size === 0 && !store.keepBrand) throw new Error("nenhum produto lido");
  return [...out.values()];
}

async function readSfcc(store) {
  const { body: html } = await get(store.url);
  const out = new Map();
  // Cada vitrine traz um JSON (data-impressiondata) com preço e preço cheio, seguido do link do produto.
  const re = /data-impressiondata="([^"]+)"[\s\S]*?<a href="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    let d;
    try {
      d = JSON.parse(decodeHtml(m[1]));
    } catch {
      continue;
    }
    const price = num(d.price);
    if (!price || !d.id) continue;
    // cada cor é acompanhada separado (ex.: Thyme, Vermelho)
    const color = /not set/i.test(d.productVariant || "") ? "" : (d.productVariant || "").trim();
    const key = `${store.id}:${d.id}${color ? ":" + color.toLowerCase() : ""}`;
    if (out.has(key)) continue;
    const link = store.base + decodeHtml(m[2]);
    out.set(key, {
      key,
      brand: d.brand || store.brand,
      name: decodeHtml(d.name) + (color ? ` — ${color}` : ""),
      url: color ? `${link}${link.includes("?") ? "&" : "?"}dwvar_${d.id}_color=${encodeURIComponent(color)}` : link,
      image: d.image ? decodeHtml(d.image) : null,
      price,
      listPrice: num(d.listPrice) > price ? num(d.listPrice) : null,
      available: d.productOutOfStock !== true,
    });
  }
  if (out.size === 0) throw new Error("nenhum produto lido");

  // A vitrine só mostra a cor padrão. Para as cores anotadas (ex.: Thyme), busca a cor
  // no site e pergunta o preço daquela cor produto por produto (1x por hora: são muitas consultas).
  for (const color of store.runColors ? store.colors || [] : []) {
    try {
      const { body } = await get(`${store.base}/search?q=${encodeURIComponent(color)}&sz=500`);
      const pids = [...new Set([...body.matchAll(/data-impressiondata="([^"]+)"/g)]
        .map((m) => { try { return JSON.parse(decodeHtml(m[1])).id; } catch { return null; } })
        .filter(Boolean))];
      const rows = await pool(pids, 3, async (pid) => {
        const { body: j } = await get(
          `${store.variation}?pid=${pid}&dwvar_${pid}_color=${encodeURIComponent(color)}&quantity=1`, { json: true, tries: 2 });
        const p = j.product;
        const sel = (p?.variationAttributes || []).find((a) => a.id === "color")?.values?.find((v) => v.selected);
        if (!p || !sel || sel.value.toLowerCase() !== color.toLowerCase()) return null; // não tem essa cor
        const price = p.price?.sales?.value ?? p.price?.min?.sales?.value;
        if (!price) return null;
        const list = p.price?.list?.value;
        return {
          key: `${store.id}:${pid}:${color.toLowerCase()}`,
          brand: store.brand,
          name: `${decodeHtml(p.productName)} — ${color}`,
          url: store.base + p.selectedProductUrl.replace(/&quantity=1$/, ""),
          image: p.images?.large?.[0]?.url,
          price,
          listPrice: list > price ? list : null,
          available: p.available !== false,
        };
      });
      for (const r of rows.filter(Boolean)) out.set(r.key, r);
      console.log(`  ${store.name}: ${rows.filter(Boolean).length} peças na cor ${color}`);
    } catch (e) {
      console.log(`  ${store.name}: falha ao buscar cor ${color}: ${e.message}`);
    }
  }
  return [...out.values()];
}

async function readMagazord(store) {
  const { body: xml } = await get(store.sitemap);
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const rows = await pool(urls, 4, async (url) => {
    const { body } = await get(url, { tries: 2 });
    for (const node of ldJson(body)) {
      const p = findProduct(node);
      if (p) return { key: `${store.id}:${url.split("/").pop()}`, brand: store.brand, url, listPrice: null, ...p };
    }
    return null;
  });
  const out = rows.filter(Boolean);
  if (out.length === 0) throw new Error("nenhum produto lido");
  return out;
}

async function readWake(store) {
  const parse = (html) => {
    for (const node of ldJson(html)) {
      if (node["@type"] === "ItemList") return { total: parseInt(node.numberOfItems, 10) || 0, items: node.itemListElement || [] };
    }
    return { total: 0, items: [] };
  };
  const per = 100;
  const first = parse((await get(`${store.search}&tamanho=${per}&pagina=1`)).body);
  const nPages = Math.ceil(first.total / per);
  const rest = await pool(
    Array.from({ length: Math.max(0, nPages - 1) }, (_, i) => i + 2),
    3,
    async (n) => parse((await get(`${store.search}&tamanho=${per}&pagina=${n}`)).body).items
  );
  const out = new Map();
  for (const p of [first.items, ...rest].flat().filter(Boolean)) {
    const price = num(p.offers?.price);
    if (!price || !p.url) continue;
    const key = `${store.id}:${p.url.split("/").pop()}`;
    out.set(key, { key, brand: store.brand, name: p.name, url: p.url, image: p.image, price, listPrice: null, available: true });
  }
  if (out.size === 0) throw new Error("nenhum produto lido");
  return [...out.values()];
}

const isOurBrand = (text) => {
  const t = (text || "").toLowerCase().replace(/[^a-z]/g, "");
  return BRANDS.find((b) => t.includes(b.toLowerCase().replace(/[^a-z]/g, "")));
};

// Lojas Shopify (Lets Eat It): o catálogo inteiro sai em /products.json
async function readShopify(store) {
  const out = new Map();
  for (let page = 1; page <= 40; page++) {
    const { body } = await get(`${store.host}/products.json?limit=250&page=${page}`, { json: true });
    const list = body.products || [];
    if (!list.length) break;
    for (const p of list) {
      const brand = isOurBrand(p.vendor) || isOurBrand(p.title);
      if (!brand) continue;
      for (const v of p.variants || []) {
        const price = num(v.price);
        if (!price || !v.available) continue;
        const key = `${store.id}:${v.id}`;
        out.set(key, {
          key,
          brand,
          name: p.title + (v.title && v.title !== "Default Title" ? ` — ${v.title}` : ""),
          url: `${store.host}/products/${p.handle}${p.variants.length > 1 ? `?variant=${v.id}` : ""}`,
          image: p.images?.[0]?.src,
          price,
          listPrice: num(v.compare_at_price) > price ? num(v.compare_at_price) : null,
          available: true,
        });
      }
    }
    await sleep(500);
  }
  return [...out.values()];
}

// Lojas WooCommerce (Cook Store): API pública da loja, marca por marca
async function readWoo(store) {
  const out = new Map();
  for (const b of store.brands || BRANDS) {
    for (let page = 1; page <= 30; page++) {
      const { body } = await get(
        `${store.host}/wp-json/wc/store/v1/products?search=${encodeURIComponent(b)}&per_page=100&page=${page}`,
        { json: true }
      );
      if (!Array.isArray(body) || !body.length) break;
      for (const p of body) {
        if (isOurBrand(p.name) !== b || !p.is_in_stock) continue;
        const div = 10 ** (p.prices?.currency_minor_unit ?? 2);
        const price = num(p.prices?.price) / div;
        const regular = num(p.prices?.regular_price) / div;
        if (!price) continue;
        const key = `${store.id}:${p.id}`;
        out.set(key, {
          key,
          brand: b,
          name: decodeHtml(p.name),
          url: p.permalink,
          image: p.images?.[0]?.src,
          price,
          listPrice: regular > price ? regular : null,
          available: true,
        });
      }
      if (body.length < 100) break;
      await sleep(500);
    }
  }
  return [...out.values()];
}

// Links avulsos do products.csv (qualquer loja que publique o preço no padrão schema.org)
async function readExtras() {
  if (!fs.existsSync(EXTRA_CSV)) return [];
  const lines = fs.readFileSync(EXTRA_CSV, "utf8").split(/\r?\n/).slice(1);
  const rows = lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [id, name, brand, url, target] = l.split(",").map((s) => (s || "").trim());
      return { id, name, brand, url, target: num(target) };
    })
    .filter((r) => r.id && /^https?:\/\//.test(r.url));
  const out = await pool(rows, 2, async (r) => {
    const { body } = await get(r.url, { tries: 2 });
    for (const node of ldJson(body)) {
      const p = findProduct(node);
      if (p) return { ...p, key: `extra:${r.id}`, brand: r.brand, name: r.name || p.name, url: r.url, listPrice: null, target: r.target };
    }
    console.log(`  preço não encontrado: ${r.url}`);
    return null;
  });
  return out.filter(Boolean);
}

// ---------- cupons ----------
// Lê a página inicial da loja e pega códigos anunciados em faixas/banners
// (ex.: "10% OFF na 1ª compra com o cupom COOK10") e descontos no Pix.
const NOT_CODES = new Set(["AQUI", "PARA", "DESCONTO", "DESCONTOS", "OFF", "VALIDO", "VÁLIDO", "NOVO", "EXCLUSIVO", "PRIMEIRA", "COMPRA", "FRETE", "GRATIS", "GRÁTIS", "BLACK", "SITE", "LOJA", "APLICADO", "AUTOMATICO"]);

const storeHome = (s) => s.home || s.host || s.base || new URL(s.search || s.sitemap).origin;

async function readCoupons(store) {
  const { body } = await get(storeHome(store), { tries: 2 });
  const text = decodeHtml(
    body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ");
  const codes = new Map();
  for (const m of text.matchAll(/(?:cupom|c[oó]digo)\s*:?\s*["“']?([A-Z][A-Z0-9]{3,19})\b/g)) {
    const code = m[1];
    if (NOT_CODES.has(code) || codes.has(code)) continue;
    // Frase do banner: do "10% OFF..." até o código, mais um "Válido para..." se vier logo depois
    const before = text.slice(Math.max(0, m.index - 90), m.index + m[0].length).split(/\s[|•*]\s?|\*\s|\s-\s/).pop();
    const pct = before.search(/\d+\s*%/);
    let phrase = (pct >= 0 ? before.slice(pct) : before).trim();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 100).split(/\s[|•*-]\s?|\*/)[0];
    if (/^\s*(v[aá]lido|em |para |nos? |nas? )/i.test(after))
      phrase += after.length >= 99 ? after.replace(/\s+\S*$/, "") + "…" : after;
    codes.set(code, phrase.trim());
  }
  const pixMatch = text.match(/(\d{1,2})\s*%\s*(?:OFF|de desconto)?\s*no\s*Pix/i);
  return { codes: [...codes].map(([code, text]) => ({ code, text })), pix: pixMatch ? `${pixMatch[1]}% de desconto no Pix` : null };
}

const READERS = { vtex: readVtex, vtexBrands: readVtexBrands, shopify: readShopify, woo: readWoo, sfcc: readSfcc, magazord: readMagazord, wake: readWake };

// ---------- histórico ----------
// state.items[key] = { b, n, u, i, s, h: [[dia, preço], ...] (só quando o preço muda), a: preço do último aviso }

function loadState() {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(STATE_FILE)).toString());
  } catch {
    return { items: {}, storeFails: {}, runs: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, zlib.gzipSync(JSON.stringify(state)));
}

// Preço "de costume": o preço que ficou mais dias no ar nos últimos 30 dias.
function usualPrice(h, nowDay) {
  const from = nowDay - RULES.usualWindowDays;
  const days = new Map();
  for (let i = 0; i < h.length; i++) {
    const start = Math.max(h[i][0], from);
    const end = i + 1 < h.length ? h[i + 1][0] : nowDay; // até a mudança seguinte (hoje não conta)
    if (end <= start) continue;
    days.set(h[i][1], (days.get(h[i][1]) || 0) + (end - start));
  }
  let best = null, bestDays = 0;
  for (const [p, d] of days) if (d > bestDays || (d === bestDays && p > best)) [best, bestDays] = [p, d];
  return best;
}

function evaluate(state, row, nowDay, todayIso) {
  const rec = (state.items[row.key] ||= { h: [] });
  Object.assign(rec, {
    b: row.brand, n: row.name, u: row.url, i: row.image, s: row.store, sn: row.storeName,
    lp: row.listPrice || null, px: row.pix || null, p: row.price, av: row.available, d: nowDay,
  });
  const h = rec.h;
  const last = h.length ? h[h.length - 1] : null;
  const isNew = !last;

  if (!row.available) return null; // sem estoque: não registra nem avisa

  const usual = usualPrice(h, nowDay);
  const prevMin = h.length ? Math.min(...h.map((x) => x[1])) : null;
  const historyDays = h.length ? nowDay - h[0][0] : 0;
  const prevPrice = last ? last[1] : null; // guardar ANTES de atualizar o histórico

  if (!last || last[1] !== row.price) {
    if (last && last[0] === nowDay) last[1] = Math.min(last[1], row.price);
    else h.push([nowDay, row.price]);
  }
  // guarda só ~120 dias de mudanças
  while (h.length > 2 && h[1][0] < nowDay - 120) h.shift();

  if (isNew) return null; // primeira vez que vemos: vira a base
  if (row.price < RULES.minPrice && !row.target) return null;

  // Voltou ao preço de costume: libera novos avisos
  if (rec.a && usual && row.price >= usual * 0.97) delete rec.a;

  const reasons = [];
  let drop = usual ? ((usual - row.price) / usual) * 100 : 0;
  if (usual && drop >= RULES.dropVsUsual) reasons.push(`${drop.toFixed(0)}% abaixo do preço de costume`);
  const dropLast = prevPrice ? ((prevPrice - row.price) / prevPrice) * 100 : 0;
  if (dropLast >= RULES.dropVsLast) {
    reasons.push(`caiu ${dropLast.toFixed(0)}% desde a última consulta (era ${brl(prevPrice)})`);
    drop = Math.max(drop, dropLast);
  }
  if (prevMin && historyDays >= RULES.minHistoryDays && row.price <= prevMin * (1 - RULES.newLowMargin / 100))
    reasons.push("menor preço já visto");
  if (row.target && row.price <= row.target) reasons.push("atingiu seu preço-alvo");
  if (!reasons.length) return null;
  if (rec.a && row.price > rec.a * (1 - RULES.realertStep / 100)) return null; // já avisado

  rec.a = row.price;
  rec.at = todayIso;
  const notes = NOTES.filter((n) => n.match(row)).map((n) => n.label);
  return { ...row, usual, prevMin, drop, reasons, notes };
}

// ---------- Telegram ----------
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method, payload) {
  if (DRY_RUN) {
    console.log(`\n[Telegram ${method}]\n${payload.caption || payload.text}\n`);
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, parse_mode: "HTML", ...payload }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram: ${data.description}`);
  await sleep(1200); // respeita o limite de mensagens do Telegram
}

// Tom neutro: só os fatos (preço, comparação, loja). Nada de "imperdível".
function alertText(a) {
  const lines = [`<b>${esc(a.brand)}</b> — ${esc(a.name)}`];
  if (a.notes.length) lines.push(esc(a.notes.join(" · ")));
  lines.push("", `Preço agora: <b>${brl(a.price)}</b>${a.pix ? ` · no Pix ${brl(a.pix)}` : ""}`);
  if (a.usual && a.usual > a.price) lines.push(`Preço de costume: ${brl(a.usual)} (−${a.drop.toFixed(0)}%)`);
  if (a.prevMin && a.prevMin > a.price) lines.push(`Menor preço visto antes: ${brl(a.prevMin)}`);
  lines.push(`Motivo: ${esc(a.reasons.join("; "))}`);
  lines.push(`Loja: ${esc(a.storeName)}`);
  const c = a.coupons;
  if (c?.pix && !a.pix) lines.push(`Site anuncia: ${esc(c.pix)}`);
  for (const k of c?.codes || []) lines.push(`Cupom no site: <code>${esc(k.code)}</code> — ${esc(k.text.slice(0, 120))}`);
  lines.push("", `<a href="${esc(a.url)}">Ver na loja</a> · confira frete, estoque e regras do cupom`);
  return lines.join("\n");
}

async function sendAlert(a) {
  const text = alertText(a);
  if (a.image) {
    try {
      return await tg("sendPhoto", { photo: a.image, caption: text });
    } catch (e) {
      console.log(`  foto falhou (${e.message}), mandando só texto`);
    }
  }
  await tg("sendMessage", { text, disable_web_page_preview: false });
}

async function sendDigest(list, title) {
  // Telegram aceita até 4096 caracteres por mensagem
  let msg = `<b>${esc(title)}</b>\n`;
  for (const a of list) {
    const line = `\n• <a href="${esc(a.url)}">${esc(a.brand)} — ${esc(a.name.slice(0, 70))}</a>: <b>${brl(a.price)}</b>${a.drop ? ` (−${a.drop.toFixed(0)}%)` : ""}${a.notes.length ? " " + esc(a.notes.join(" ")) : ""}`;
    if (msg.length + line.length > 3900) {
      await tg("sendMessage", { text: msg, disable_web_page_preview: true });
      msg = "";
    }
    msg += line;
  }
  if (msg.trim()) await tg("sendMessage", { text: msg, disable_web_page_preview: true });
}

// Resumo diário: peças Thyme em estoque, maiores descontos anunciados pelas lojas e cupons.
async function sendDailyDigest(state, nowDay) {
  // mesma peça pode entrar 2x (vitrine + busca por cor): fica uma por loja/nome/preço
  const seen = new Set();
  const live = Object.values(state.items)
    .filter((r) => r.d >= nowDay - 1 && r.av !== false && r.p)
    .filter((r) => {
      const k = `${r.s}|${r.n}|${r.p}`;
      return !seen.has(k) && seen.add(k);
    });
  const perStore = (list, n) => {
    const c = {};
    return list.filter((r) => (c[r.s] = (c[r.s] || 0) + 1) <= n);
  };
  const total = live.length;
  const line = (r, extra = "") =>
    `\n• <a href="${esc(r.u)}">${esc(r.n.slice(0, 75))}</a> — <b>${brl(r.p)}</b>${r.px ? ` (Pix ${brl(r.px)})` : ""} · ${esc(r.sn || r.s)}${extra}`;

  const thyme = live
    .filter((r) => /creuset/i.test(r.b) && /thyme|tomilho/i.test(`${r.n} ${r.u}`) && r.p >= RULES.minPrice)
    .sort((a, b) => a.p - b.p);
  let msg = `<b>Resumo do dia — Casa Premium</b>\n${total.toLocaleString("pt-BR")} produtos acompanhados agora.`;
  msg += `\n\n<b>🌿 Le Creuset Thyme em estoque (${thyme.length})</b>`;
  for (const r of thyme.slice(0, 25)) msg += line(r);
  if (thyme.length > 25) msg += `\n… e mais ${thyme.length - 25}.`;
  await tg("sendMessage", { text: msg, disable_web_page_preview: true });

  const disc = live
    .filter((r) => r.lp && r.p >= RULES.minPrice)
    .map((r) => ({ ...r, off: ((r.lp - r.p) / r.lp) * 100 }))
    .filter((r) => r.off >= 20)
    .sort((a, b) => b.off - a.off);
  let msg2 = `<b>Maiores descontos anunciados pelas lojas hoje</b>\n(é o "de/por" da própria loja; o bot ainda está montando o histórico para conferir)`;
  for (const r of perStore(disc, 3).slice(0, 15)) msg2 += line(r, ` · de ${brl(r.lp)} (−${r.off.toFixed(0)}%)`);
  if (!disc.length) msg2 += "\nNenhum acima de 20%.";

  const cup = STORES.filter((s) => state.coupons?.[s.id]?.codes.length || state.coupons?.[s.id]?.pix);
  if (cup.length) {
    msg2 += `\n\n<b>Cupons e descontos anunciados nos sites</b>`;
    for (const s of cup) {
      const c = state.coupons[s.id];
      const parts = [...c.codes.map((k) => `<code>${esc(k.code)}</code> (${esc(k.text.slice(0, 90))})`), c.pix ? esc(c.pix) : ""].filter(Boolean);
      msg2 += `\n• ${esc(s.name)}: ${parts.join(" · ")}`;
    }
  }
  await tg("sendMessage", { text: msg2, disable_web_page_preview: true });
}

// ---------- principal ----------
async function main() {
  if (TEST_ONLY) {
    // Teste: manda um alerta de exemplo com um produto real (peça Le Creuset Thyme, preço de agora)
    const lc = { ...STORES.find((s) => s.id === "lecreuset"), runColors: true };
    const rows = (await readSfcc(lc)).filter((r) => r.available && /thyme/i.test(r.name) && r.price >= RULES.minPrice);
    const p = rows.sort((a, b) => a.price - b.price)[0];
    let coupons = null;
    try { coupons = await readCoupons(lc); } catch {}
    await tg("sendMessage", {
      text: "🧪 <b>Teste do Casa Premium</b>\nA mensagem abaixo é só um exemplo de como chega um alerta. O preço é real, de agora, mas <b>não houve queda</b>.",
    });
    if (p) {
      await sendAlert({
        ...p, storeName: lc.name, coupons, notes: ["🌿 Cor Thyme"], usual: null, prevMin: null, drop: 0,
        reasons: ["exemplo de teste (sem queda real)"],
      });
    }
    console.log(`Teste enviado${p ? ` com ${p.name} a ${brl(p.price)}` : ""}.`);
    return;
  }
  if (DRY_RUN) console.log("Modo simulação: nada será enviado ao Telegram.");

  const state = loadState();
  const firstRun = Object.keys(state.items).length === 0;
  const todayIso = today();
  const nowDay = dayNum(todayIso);
  const alerts = [];
  const summary = [];
  const broken = [];

  state.lastRead ||= {};
  state.coupons ||= {};
  const due = (key, everyMin) => ONLY.length || !state.lastRead[key] || Date.now() - state.lastRead[key] >= everyMin * 60000 - 120000;
  const newCoupons = [];

  const stores = ONLY.length ? STORES.filter((s) => ONLY.includes(s.id)) : STORES;
  for (const store of stores) {
    // Cupons no site da loja (1x por hora)
    if (due(`cupom:${store.id}`, RULES.couponsEveryMin)) {
      try {
        const c = await readCoupons(store);
        const before = state.coupons[store.id];
        if (before) for (const k of c.codes) if (!before.codes.some((o) => o.code === k.code)) newCoupons.push({ store: store.name, ...k });
        state.coupons[store.id] = c;
        state.lastRead[`cupom:${store.id}`] = Date.now();
        if (c.codes.length || c.pix) console.log(`  cupons ${store.name}: ${c.codes.map((k) => k.code).join(", ") || "-"} ${c.pix || ""}`);
      } catch (e) {
        console.log(`  cupons ${store.name}: falha (${e.message})`);
      }
    }

    // Lojas lentas e as cores anotadas da Le Creuset: 1x por hora
    if (store.heavy && !due(store.id, RULES.heavyEveryMin)) continue;
    store.runColors = due(`${store.id}:cores`, RULES.heavyEveryMin);

    const t0 = Date.now();
    try {
      const rows = await READERS[store.type](store);
      state.lastRead[store.id] = Date.now();
      if (store.runColors) state.lastRead[`${store.id}:cores`] = Date.now();
      for (const row of rows) {
        row.store = store.id;
        row.storeName = store.name;
        const a = evaluate(state, row, nowDay, todayIso);
        if (a) alerts.push(a);
      }
      state.storeFails[store.id] = 0;
      summary.push(`${store.name}: ${rows.length}`);
      console.log(`OK ${store.name}: ${rows.length} produtos em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      const n = (state.storeFails[store.id] || 0) + 1;
      state.storeFails[store.id] = n;
      console.log(`ERRO ${store.name} (${n}ª seguida): ${e.message}`);
      if (n === 3) broken.push(store.name); // avisa uma vez, na 3ª falha seguida
    }
  }

  if (!ONLY.length) {
    try {
      const extras = await readExtras();
      for (const row of extras) {
        row.storeName = new URL(row.url).hostname.replace(/^www\./, "");
        const a = evaluate(state, row, nowDay, todayIso);
        if (a) alerts.push(a);
      }
      if (extras.length) summary.push(`Links avulsos: ${extras.length}`);
    } catch (e) {
      console.log(`ERRO links avulsos: ${e.message}`);
    }
  }

  state.runs = (state.runs || 0) + 1;
  saveState(state); // salva antes de enviar: se o Telegram falhar, não repete avisos em massa

  if (firstRun) {
    await tg("sendMessage", {
      text:
        `✅ <b>Casa Premium ligado</b>\n\nAgora monitorando:\n${esc(summary.join("\n"))}\n\n` +
        `Os preços de hoje viram a base. Daqui pra frente eu aviso quando um preço cair ` +
        `${RULES.dropVsLast}% ou mais de uma consulta para outra, ficar ${RULES.dropVsUsual}% abaixo do preço de costume ` +
        `ou bater o menor preço já visto.` +
        (Object.keys(state.coupons).length
          ? "\n\nCupons anunciados nos sites hoje:\n" +
            STORES.filter((s) => state.coupons[s.id]?.codes.length || state.coupons[s.id]?.pix)
              .map((s) => `• ${esc(s.name)}: ${[...state.coupons[s.id].codes.map((k) => esc(k.code)), esc(state.coupons[s.id].pix || "")].filter(Boolean).join(" · ")}`)
              .join("\n")
          : ""),
    });
  }

  for (const a of alerts) a.coupons = state.coupons[a.store];

  // Resumo do dia (1x por dia a partir das 9h de Brasília, ou quando pedido)
  const brtHour = (new Date().getUTCHours() + 21) % 24;
  if (!ONLY.length && (FORCE_DIGEST || (brtHour >= 9 && state.lastDigest !== todayIso))) {
    await sendDailyDigest(state, nowDay);
    state.lastDigest = todayIso;
    saveState(state);
  }

  // Cupom novo apareceu no site de uma loja
  if (newCoupons.length && !firstRun) {
    await tg("sendMessage", {
      text: newCoupons
        .map((k) => `Cupom novo no site da <b>${esc(k.store)}</b>: <code>${esc(k.code)}</code>\n${esc(k.text.slice(0, 160))}`)
        .join("\n\n"),
    });
  }

  // anotados (ex.: Thyme) primeiro, depois as maiores quedas
  alerts.sort((x, y) => y.notes.length - x.notes.length || y.drop - x.drop);
  const singles = alerts.slice(0, RULES.maxSinglePerRun);
  const extra = alerts.slice(RULES.maxSinglePerRun);
  for (const a of singles) {
    try {
      await sendAlert(a);
    } catch (e) {
      console.log(`Falha ao avisar ${a.key}: ${e.message}`);
    }
  }
  if (extra.length) await sendDigest(extra, `+${extra.length} quedas de preço nesta rodada`);
  if (broken.length)
    await tg("sendMessage", {
      text: `⚠️ Não consegui ler ${esc(broken.join(", "))} nas últimas 3 consultas. A loja pode ter mudado o site.`,
    });

  console.log(`Fim. Alertas: ${alerts.length}. Produtos no histórico: ${Object.keys(state.items).length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
