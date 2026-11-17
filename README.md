# Casa Premium — alerta de preço baixo no Telegram

O bot lê **sozinho o catálogo inteiro** de lojas brasileiras confiáveis, guarda o histórico de preços
e avisa no Telegram (com foto e link) quando um produto cai de preço de verdade.

Marcas: Le Creuset, Smeg, KitchenAid, Karsten, Trussardi, Buddemeyer.

## Lojas monitoradas

| Loja | O que vem de lá |
|---|---|
| lecreuset.com.br (oficial) | todo o catálogo Le Creuset |
| smegbrasil.com.br (oficial) | todo o catálogo Smeg |
| kitchenaid.com.br (oficial) | todo o catálogo KitchenAid |
| karsten.com.br (oficial) | todo o catálogo Karsten |
| trussardi.com.br (oficial) | todo o catálogo Trussardi |
| casaalmeida.com.br (loja do grupo Buddemeyer) | produtos Buddemeyer |
| americanas.com.br | só produtos das marcas acima |
| spicy.com.br | só produtos das marcas acima |
| letseatit.com.br | só produtos das marcas acima |
| cookstore.com.br | só produtos das marcas acima |

Fora por enquanto: Amazon, Magalu, Casas Bahia, Mercado Livre e Camicado bloqueiam robôs.

## Quando chega um alerta

- O preço ficou **15% ou mais abaixo do preço de costume** (o preço que ficou mais dias no ar nos últimos 30 dias); ou
- bateu o **menor preço já visto** pelo bot (com pelo menos 3 dias de histórico); ou
- atingiu o **preço-alvo** de um link avulso do `products.csv`.

O "de/por" da loja sozinho **não** gera alerta, para não cair em desconto de mentira.
Produtos abaixo de R$ 100 (peças, acessórios) são ignorados. Cada produto só é avisado de novo se cair mais 3%.
Em rodadas com muitas quedas, as 12 maiores vêm com foto e o resto num resumo.

As regras ficam no começo do `bot.mjs` (bloco `RULES`) e a lista de marcas em `BRANDS`.

## Como roda

GitHub Actions, a cada 3 horas, sem depender de computador ligado.
A primeira rodada só monta a base de preços (manda uma mensagem "Casa Premium ligado").
O histórico fica guardado no cache do GitHub Actions.

Secrets necessários (Settings → Secrets and variables → Actions):
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Testar o Telegram: aba **Actions** → **Casa Premium** → **Run workflow** → marcar "Só testar o envio do Telegram".

## Rodar no próprio computador (opcional)

Precisa do Node 22+. Sem token, roda em modo simulação e mostra os alertas no terminal:

```
node bot.mjs
ONLY=smeg,lecreuset node bot.mjs   # só algumas lojas
```
