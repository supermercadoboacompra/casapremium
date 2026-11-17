# Casa Premium — alerta de preço baixo no Telegram

O bot lê **sozinho o catálogo inteiro** de lojas brasileiras confiáveis, guarda o histórico de preços
e avisa no Telegram (com foto e link) quando um produto cai de preço de verdade.

Marcas: Le Creuset, Smeg, KitchenAid, Karsten, Trussardi, Buddemeyer, Trousseau, Altenburg, Bialetti,
Staub, Zwilling, Wüsthof, Peugeot, Riedel, Spiegelau, Schott Zwiesel, Vista Alegre, Emile Henry, Wolff, Laguiole,
Mozart, Breville, Ninja, Zojirushi, Cuisinart (só acima de R$ 500) e Dyson. A lista fica em `BRANDS` no `bot.mjs`.

## Lojas monitoradas

| Loja | O que vem de lá |
|---|---|
| lecreuset.com.br (oficial) | todo o catálogo Le Creuset |
| smegbrasil.com.br (oficial) | todo o catálogo Smeg |
| kitchenaid.com.br (oficial) | todo o catálogo KitchenAid |
| karsten.com.br (oficial) | todo o catálogo Karsten |
| trussardi.com.br (oficial) | todo o catálogo Trussardi |
| casaalmeida.com.br (loja do grupo Buddemeyer) | produtos Buddemeyer |
| trousseau.com.br (oficial) | todo o catálogo Trousseau |
| altenburg.com.br (oficial) | catálogo Altenburg (1x por hora) |
| lazershop.com.br | Wüsthof, Peugeot, Zwilling, Staub, Schott Zwiesel, Bialetti (a cada 15 min) |
| americanas.com.br | só produtos das marcas acima (1x por hora) + TVs Samsung 55" (a cada rodada, inclusive vendidas por Magalu, Fast Shop e Colombo) |
| kabum.com.br | TVs Samsung 55" |
| spicy.com.br | só produtos das marcas acima |
| letseatit.com.br | só produtos das marcas acima |
| cookstore.com.br | só produtos das marcas acima |

Fora por enquanto: Amazon, Magalu, Casas Bahia, Mercado Livre, Camicado, Westwing, Tok&Stok e os sites próprios de
Zwilling, Vista Alegre, Nespresso, Riedel e Dyson bloqueiam robôs ou não abrem o catálogo. Bialetti (site próprio) estava fora do ar.

## TV Samsung 55"

Qualquer modelo de 55" (Crystal, QLED, Neo QLED/Mini LED, OLED, The Frame, Micro RGB), sem acessórios.
O resumo das 9h mostra a mais barata de cada tipo. Para acompanhar outro produto assim, é só criar outra linha em `WATCHES` no `bot.mjs`.

## Lojas que rodam no PC

Smeg e Lazer Shop bloqueiam os servidores do GitHub. Elas rodam pela pasta `Desktop/Claude/casapremium-local`
(agendador do Windows, a cada 15 min, só com o PC ligado). O token do Telegram fica em `config.cmd` nessa pasta, fora do repositório.

## Quando chega um alerta

- O preço **caiu 10% ou mais de uma consulta para a outra** (avisa na hora, sem precisar de histórico); ou
- ficou **15% ou mais abaixo do preço de costume** (o preço que ficou mais dias no ar nos últimos 30 dias); ou
- bateu o **menor preço já visto** pelo bot (com pelo menos 3 dias de histórico); ou
- atingiu o **preço-alvo** de um link avulso do `products.csv`.

O "de/por" da loja sozinho **não** gera alerta, para não cair em desconto de mentira.
Produtos abaixo de R$ 100 (peças, acessórios) são ignorados. Cada produto só é avisado de novo se cair mais 3%.
Todo dia às 9h chega um **resumo**: peças Le Creuset Thyme em estoque com preço, os maiores descontos anunciados pelas lojas (até 3 por loja) e os cupons dos sites.
Em rodadas com muitas quedas, as 12 maiores vêm com foto e o resto num resumo.

Peças Le Creuset na cor **Thyme** vêm marcadas com "🌿 Cor Thyme" e passam na frente.

A mensagem traz também o **preço no Pix** (quando a loja informa) e os **cupons anunciados no site da loja**
(ex.: `COOK10`, `MUNDOTRUSSARDI`). Quando um cupom novo aparece num site, chega uma mensagem própria.
Cupons de sites de cupom (Cuponomia, Méliuz) não entram: lá o código fica escondido atrás de link de afiliado.

As regras ficam no começo do `bot.mjs` (bloco `RULES`) e a lista de marcas em `BRANDS`.

## Como roda

GitHub Actions, **a cada ~5 minutos**: cada rodada dispara a próxima ao terminar (o agendamento do GitHub fica só de reserva, a cada 30 min, porque ele atrasa ou pula intervalos curtos), sem depender de computador ligado.
Smeg (425 páginas) e as peças Thyme do site oficial Le Creuset são lidas 1x por hora; cupons também 1x por hora.

**O repositório precisa ser público** para rodar a cada 5 minutos de graça
(repositório privado tem só 2.000 minutos/mês, o que acabaria em ~5 dias).
O código não tem senha nenhuma: token e chat do Telegram ficam nos Secrets, que continuam privados.
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
