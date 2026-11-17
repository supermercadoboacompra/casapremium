import csv, json, os, re, sqlite3, sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

DB = "prices.sqlite3"
PRODUCTS_FILE = "products.csv"
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; CasaPremiumPriceMonitor/1.0; +https://github.com/)"
}

def db():
    con = sqlite3.connect(DB)
    con.execute("""CREATE TABLE IF NOT EXISTS prices (
        product_id TEXT, checked_at TEXT, price REAL, currency TEXT,
        PRIMARY KEY(product_id, checked_at)
    )""")
    con.execute("""CREATE TABLE IF NOT EXISTS alerts (
        product_id TEXT, checked_at TEXT, price REAL,
        PRIMARY KEY(product_id, checked_at)
    )""")
    return con

def price_from_jsonld(obj):
    if isinstance(obj, list):
        for item in obj:
            found = price_from_jsonld(item)
            if found:
                return found
    if isinstance(obj, dict):
        typ = obj.get("@type", [])
        if isinstance(typ, str):
            typ = [typ]
        if "Product" in typ or "Offer" in typ:
            offers = obj.get("offers", obj)
            if isinstance(offers, list):
                for offer in offers:
                    found = price_from_jsonld(offer)
                    if found:
                        return found
            if isinstance(offers, dict):
                raw = offers.get("price") or offers.get("lowPrice")
                currency = offers.get("priceCurrency", "BRL")
                parsed = parse_price(raw)
                if parsed:
                    return parsed, currency
        for value in obj.values():
            found = price_from_jsonld(value)
            if found:
                return found
    return None

def parse_price(raw):
    if raw is None:
        return None
    try:
        if isinstance(raw, (int, float)):
            value = Decimal(str(raw))
        else:
            s = re.sub(r"[^\d,\.]", "", str(raw))
            if not s:
                return None
            # Brazilian formatting: 1.299,90
            if "," in s:
                s = s.replace(".", "").replace(",", ".")
            value = Decimal(s)
        if value <= 0 or value > 10000000:
            return None
        return float(value)
    except (InvalidOperation, ValueError):
        return None

def extract_price(html):
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            found = price_from_jsonld(json.loads(script.string or script.get_text()))
            if found:
                return found
        except (json.JSONDecodeError, TypeError):
            pass

    candidates = [
        ('meta[property="product:price:amount"]', "content"),
        ('meta[property="og:price:amount"]', "content"),
        ('meta[itemprop="price"]', "content"),
        ('meta[itemprop="price"]', "value"),
    ]
    for selector, attr in candidates:
        node = soup.select_one(selector)
        if node:
            value = parse_price(node.get(attr))
            if value:
                currency_node = soup.select_one('meta[property="product:price:currency"]')
                currency = currency_node.get("content", "BRL") if currency_node else "BRL"
                return value, currency
    return None

def money(value, currency="BRL"):
    if currency == "BRL":
        return ("R$ {:,.2f}".format(value)).replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{currency} {value:,.2f}"

def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    response = requests.post(url, json={
        "chat_id": CHAT_ID, "text": text, "disable_web_page_preview": False
    }, timeout=25)
    response.raise_for_status()

def main():
    con = db()
    with open(PRODUCTS_FILE, newline="", encoding="utf-8-sig") as f:
        products = list(csv.DictReader(f))

    for p in products:
        pid, name, brand, url = (p.get(k, "").strip() for k in ("id", "name", "brand", "url"))
        if not all([pid, name, url]) or not url.startswith(("http://", "https://")):
            print(f"Skipping invalid row: {p}")
            continue
        try:
            response = requests.get(url, headers=HEADERS, timeout=30)
            response.raise_for_status()
            extracted = extract_price(response.text)
            if not extracted:
                print(f"No structured price found: {url}")
                continue
            price, currency = extracted
            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            previous = con.execute(
                "SELECT price FROM prices WHERE product_id=? ORDER BY checked_at DESC LIMIT 1",
                (pid,)
            ).fetchone()
            con.execute("INSERT OR IGNORE INTO prices VALUES (?,?,?,?)",
                        (pid, now, price, currency))
            con.commit()

            threshold = float(p.get("alert_below_price") or 0)
            discount_min = float(p.get("min_drop_percent") or 15)
            should_alert = price <= threshold if threshold > 0 else False
            if previous and previous[0] > 0:
                drop = (previous[0] - price) / previous[0] * 100
                should_alert = should_alert or drop >= discount_min
            else:
                drop = 0

            already = con.execute(
                "SELECT 1 FROM alerts WHERE product_id=? AND price=?",
                (pid, price)
            ).fetchone()
            if should_alert and not already:
                text = (
                    f"🔥 POSSÍVEL OFERTA — {brand} {name}\n"
                    f"Preço encontrado: {money(price, currency)}\n"
                    f"Queda desde a última consulta: {drop:.1f}%\n"
                    f"Loja: {urlparse(url).netloc}\n"
                    f"Link: {url}\n\n"
                    "Atenção: confirme frete, estoque e preço no checkout. "
                    "O histórico começa a ser construído a partir da ativação."
                )
                send_telegram(text)
                con.execute("INSERT OR IGNORE INTO alerts VALUES (?,?,?)", (pid, now, price))
                con.commit()
            print(f"OK {name}: {money(price, currency)}")
        except Exception as e:
            print(f"ERROR {name}: {e}", file=sys.stderr)

    con.close()

if __name__ == "__main__":
    main()
