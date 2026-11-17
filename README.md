# Casa Premium — monitor de preços

Primeira versão gratuita, baseada em URLs de produtos cadastradas manualmente.

## O que faz
- Consulta as páginas cadastradas em `products.csv` a cada 6 horas.
- Tenta ler preços estruturados (JSON-LD / metadados).
- Guarda histórico local em SQLite.
- Envia alerta ao Telegram quando atinge o preço-alvo ou cai pelo percentual configurado.

## Limitações importantes
- Não faz descoberta automática de todos os produtos de uma marca.
- Cada loja tem estrutura própria; algumas páginas usam JavaScript, bloqueiam robôs ou não expõem preço estruturado.
- O histórico começa quando o monitor é ativado; não inventa histórico anterior.
- A queda percentual inicial compara com a consulta anterior, não com um histórico de mercado completo.
- Respeite os termos de uso e limites dos sites. Não contorna login, CAPTCHA ou bloqueios.

## Configuração
1. Crie um repositório GitHub e envie estes arquivos.
2. No Telegram, abra `https://t.me/casapremium_bot` e toque em **Start**.
3. Obtenha o `chat_id` enviando uma consulta `getUpdates` à Bot API, conforme a documentação oficial:
   `https://core.telegram.org/bots/api#getupdates`
4. No GitHub: Settings → Secrets and variables → Actions → New repository secret:
   - `TELEGRAM_BOT_TOKEN`: token fornecido pelo BotFather.
   - `TELEGRAM_CHAT_ID`: seu chat ID numérico.
5. Edite `products.csv`, substituindo a linha de exemplo por URLs reais de produtos.
6. Em Actions, execute **Monitorar preços** → Run workflow para testar.

## Colunas do products.csv
- `id`: identificador único.
- `name`: nome do produto.
- `brand`: marca.
- `url`: URL direta da página do produto.
- `alert_below_price`: preço máximo para alertar (0 desativa).
- `min_drop_percent`: queda mínima em relação à consulta anterior.

## Segurança
Nunca publique o token do Telegram no código, em issues ou em mensagens. Use apenas GitHub Secrets.
