import csv
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]
DB_FILE = "prices.sqlite3"
CSV_FILE = "products.csv"
MIN_DROP = float(os.getenv("DEFAULT_MIN_DROP_PERCENT", "15"))
TEST_ONLY = os.getenv("TEST_ONLY", "false").lower() == "true"
TIMEOUT = 25
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CasaPremiumBot/2.0)"}


def telegram(message):
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    r = requests.post(url, json={
        "chat_id": CHAT_ID,
        "text": message,
        "disable_web_page_preview": False
    }, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram API: {data}")
    return data


def init_db():
    con = sqlite3.connect(DB_FILE)
    con.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            product_id TEXT NOT NULL,
            checked_at TEXT NOT NULL,
            price REAL NOT NULL,
            currency TEXT NOT NULL,
            PRIMARY KEY(product_id, checked_at)
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS sent_alerts (
            product_id TEXT NOT NULL,
            price REAL NOT NULL,
            sent_at TEXT NOT NULL,
            PRIMARY KEY(product_id, price)
        )
    """)
    con.commit()
    return con


def parse_price(raw):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        try:
            val = float(raw)
            return val if val > 0 else None
        except Exception:
            return None
    s = re.sub(r"[^0-9,\.]", "", str(raw).strip())
    if not s:
        return None
    # Handle Brazilian thousands/decimal notation.
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        val = float(Decimal(s))
        return val if val > 0 else None
    except (InvalidOperation, ValueError):
        return None


def find_offer(node):
    if isinstance(node, list):
        for child in node:
            result = find_offer(child)
            if result:
                return result
    elif isinstance(node, dict):
        typ = node.get("@type", [])
        if isinstance(typ, str):
            typ = [typ]
        if "Product" in typ or "Offer" in typ:
            offers = node.get("offers", node)
            if isinstance(offers, list):
                for offer in offers:
                    result = find_offer(offer)
                    if result:
                        return result
            elif isinstance(offers, dict):
                price = parse_price(offers.get("price") or offers.get("lowPrice"))
                if price:
                    return price, str(offers.get("priceCurrency") or "BRL")
        for value in node.values():
            result = find_offer(value)
            if result:
                return result
    return None


def extract_price(html):
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            result = find_offer(json.loads(script.string or script.get_text()))
            if result:
                return result
        except (json.JSONDecodeError, TypeError):
            continue

    selectors = [
        ('meta[property="product:price:amount"]', "content"),
        ('meta[property="og:price:amount"]', "content"),
        ('meta[itemprop="price"]', "content"),
        ('meta[itemprop="price"]', "value"),
    ]
    for selector, attr in selectors:
        el = soup.select_one(selector)
        if el:
            price = parse_price(el.get(attr))
            if price:
                return price, "BRL"
    return None


def fmt_money(value, currency):
    if currency == "BRL":
        return ("R$ {:,.2f}".format(value)
                .replace(",", "X").replace(".", ",").replace("X", "."))
    return f"{currency} {value:,.2f}"


def load_products():
    with open(CSV_FILE, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def main():
    # A manual test run verifies Telegram credentials without scraping stores.
    if TEST_ONLY:
        telegram("✅ Casa Premium conectado! O bot conseguiu enviar mensagens pelo Telegram.")
        print("Telegram test sent.")
        return

    products = load_products()
    if not products:
        telegram("⚠️ Casa Premium está ativo, mas products.csv não tem produtos cadastrados.")
        return

    con = init_db()
    now = datetime.now(timezone.utc)
    checked_at = now.isoformat(timespec="seconds")
    scanned, failed, alerts = 0, 0, 0

    for p in products:
        product_id = (p.get("id") or "").strip()
        name = (p.get("name") or "").strip()
        brand = (p.get("brand") or "").strip()
        url = (p.get("url") or "").strip()
        if not product_id or not name or not url.startswith(("https://", "http://")):
            print(f"Linha ignorada por dados incompletos: {p}")
            continue

        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            response.raise_for_status()
            extracted = extract_price(response.text)
            if not extracted:
                print(f"Preço não encontrado (pode exigir JavaScript ou bloquear robôs): {url}")
                failed += 1
                continue

            price, currency = extracted
            con.execute(
                "INSERT OR IGNORE INTO price_history VALUES (?, ?, ?, ?)",
                (product_id, checked_at, price, currency)
            )
            history = con.execute(
                "SELECT price FROM price_history WHERE product_id=? ORDER BY checked_at DESC",
                (product_id,)
            ).fetchall()
            prices = [row[0] for row in history]
            old_prices = prices[1:]
            previous = old_prices[0] if old_prices else None
            historical_min = min(prices) if prices else price

            target = parse_price(p.get("alert_below_price"))
            threshold = parse_price(p.get("min_drop_percent"))
            min_drop = float(threshold) if threshold is not None else MIN_DROP
            target_hit = target is not None and price <= target
            new_record_low = previous is not None and price < min(old_prices)
            drop = ((previous - price) / previous * 100) if previous and price < previous else 0
            percentage_hit = previous is not None and drop >= min_drop

            already = con.execute(
                "SELECT 1 FROM sent_alerts WHERE product_id=? AND price=?",
                (product_id, price)
            ).fetchone()

            # Do not alert on the first observation: it establishes the baseline.
            if len(prices) >= 2 and not already and (target_hit or new_record_low or percentage_hit):
                reason = []
                if target_hit:
                    reason.append(f"atingiu seu preço-alvo ({fmt_money(target, currency)})")
                if new_record_low:
                    reason.append("novo menor preço registrado pelo bot")
                if percentage_hit:
                    reason.append(f"queda de {drop:.1f}% desde a última consulta")
                message = (
                    f"🔥 OFERTA POSSÍVEL — {brand} {name}\n\n"
                    f"Preço encontrado: {fmt_money(price, currency)}\n"
                    f"Menor preço observado pelo bot: {fmt_money(historical_min, currency)}\n"
                    f"Motivo: {', '.join(reason)}\n"
                    f"Loja: {urlparse(url).netloc}\n\n"
                    f"{url}\n\n"
                    "Confira frete, estoque e preço final no checkout. "
                    "O histórico começa na data em que o bot foi ativado."
                )
                telegram(message)
                con.execute(
                    "INSERT OR IGNORE INTO sent_alerts VALUES (?, ?, ?)",
                    (product_id, price, checked_at)
                )
                alerts += 1

            con.commit()
            scanned += 1
            print(f"OK: {brand} {name} — {fmt_money(price, currency)}")
            time.sleep(2)

        except Exception as exc:
            failed += 1
            print(f"ERRO em {name}: {exc}", file=sys.stderr)

    con.commit()
    con.close()
    print(f"Finalizado. Consultados: {scanned}; falhas: {failed}; alertas: {alerts}.")


if __name__ == "__main__":
    main()
