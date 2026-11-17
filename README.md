# Casa Premium Bot — v2

## Arquivos
- `bot.py`: consulta páginas de produtos e envia alertas.
- `products.csv`: lista de URLs de produtos.
- `.github/workflows/casa-premium.yml`: execução manual e agendada a cada 6 horas.

## Secrets obrigatórios no GitHub
Settings → Secrets and variables → Actions:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

No Telegram, abra @casapremium_bot e envie `/start` antes do primeiro teste.

## Primeiro teste
Na aba Actions, abra o workflow **Casa Premium** e clique em Run workflow.
Deixe `Apenas testar o envio do Telegram` marcado. A execução deve mandar uma mensagem de confirmação.

## Ativar consultas de produtos
Depois do teste, edite `products.csv`: remova a linha de comentário e adicione uma linha por URL direta de produto:
`id,nome,marca,url,preco_alvo,queda_minima_percentual`

Exemplo fictício:
`lecreuset-cocotte-24,Cocotte 24 cm,Le Creuset,https://loja.exemplo/produto,1800,15`

No próximo Run workflow, desmarque o teste para consultar as páginas. A agenda automática roda a cada 6 horas.

## Limitações
- O bot não descobre automaticamente todo o catálogo das marcas; monitora URLs cadastradas.
- Algumas lojas bloqueiam robôs ou carregam preços via JavaScript. Nesses casos, o preço não será extraído por esta versão.
- O histórico começa quando o bot é ativado. Não representa histórico de mercado anterior.
- A comparação percentual é contra a consulta anterior; o menor preço é o menor observado pelo próprio bot.
- GitHub Actions tem limites de uso e a execução agendada pode atrasar.
- Respeite termos de uso e limites das lojas.
