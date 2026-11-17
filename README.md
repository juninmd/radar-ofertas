# 🔥 Radar de Ofertas

Crawler de e-commerce (**Mercado Livre, Amazon, Magazine Luiza**) que rastreia
preços, mantém **histórico**, detecta **promoções reais** (preço abaixo da média
histórica), **notifica no Telegram** e aprende com seu **feedback (👍/👎)** para
priorizar as categorias que você curte. Análise opcional via **LiteLLM**.

Stack: **Bun** + TypeScript + `bun:sqlite`, `Bun.serve`, `Bun.SQL` (Postgres) e `bun test` nativos. Dependências: cheerio (parsing) e puppeteer (fallback de browser anti-bot).

## Como funciona

```
crawl (ML/Amazon/Magalu) ──▶ price_history ──▶ detecção de oferta ──▶ score
                                                     │                   │
                          recomendação (feedback) ◀──┘                   ▼
                                                              IA (LiteLLM) + Telegram
```

1. **Coleta** — busca cada termo (`CRAWL_QUERIES`) em cada fonte. As fontes
   rodam **em paralelo** (`CRAWL_CONCURRENCY`), cada uma com throttle próprio;
   sites com anti-bot agressivo caem para um crawler de browser. O resultado
   passa por um filtro de sanidade (preço inválido/absurdo, título degenerado,
   duplicados) antes de virar histórico.
   - **Magalu**: `magazineluiza.com.br` é barrado pelo Akamai, então a coleta usa
     `clube.magazineluiza.com.br` (nginx puro, sem anti-bot) com
     `magazinevoce.com.br` como redundância — mesmo catálogo e mesmos preços,
     conferidos produto a produto. Os links são reescritos para o domínio canônico.
   - **zoom / buscape**: comparadores — 1 GET devolve ~30 produtos já com o menor
     preço de mercado entre as lojas parceiras.
2. **Histórico** — cada execução grava um ponto na série temporal do produto.
3. **Detecção** — com ≥`MIN_HISTORY_POINTS`, compara o preço atual com média e
   desvio-padrão. É oferta se `z ≤ -Z_THRESHOLD` **ou** desconto `≥ MIN_DISCOUNT_PCT`.
4. **Recomendação** — o `score` final = força do desconto × afinidade. A
   afinidade sobe nas categorias/keywords que você **curtiu** (ex.: curtiu whey
   ⇒ próximas promoções de whey pontuam mais ⇒ mais chance de notificar).
5. **Notificação** — se `score ≥ NOTIFY_SCORE`, gera um comentário curto via
   **LiteLLM** e envia ao **Telegram** com botões 👍/👎 inline. O ciclo posta no
   máximo `MAX_NOTIFICATIONS_PER_CYCLE` mensagens, priorizando o maior desconto
   anunciado; as demais ofertas ficam gravadas no histórico e no dashboard.

## Oferta de verdade (anti "metade do dobro")

- **Referência robusta**: mediana do histórico (60d), calculada **sem** a leitura atual — picos não inflam a média e o preço avaliado não puxa a própria referência.
- **Subiu antes de baixar**: se a mediana recente está acima da de >14 dias, o desconto é medido no preço antigo (flag `preco-maquiado`).
- **Black Friday**: compara com o preço **antes de 1/nov** (`BF_BASELINE_CUTOFF`), ignorando a maquiagem de outubro/novembro.
- **Mercado**: o mesmo produto (casado por título + números de modelo/capacidade) mais barato em outra loja **derruba** a oferta; ser o menor entre lojas dá bônus.
- **Histórico mínimo de 24h** (`MIN_HISTORY_HOURS`). Antes disso só vale o preço "de" do site, com régua mais dura (≥20%, ≥30% na temporada) e **sem notificar** salvo confirmação de mercado (`LISTPRICE_NOTIFY=market`).
- **Re-oferta**: o mesmo produto volta a alertar se **cair mais** `REDEAL_DROP_PCT`% (flag `caiu-mais`) — antes era bloqueado para sempre.
- **Ranking do ciclo**: avalia tudo primeiro e gasta o teto de mensagens nas maiores pontuações (não nas primeiras coletadas).

## Mais vendidos

- `BESTSELLER_SOURCES=mercadolivre,amazon`: lê `mercadolivre.com.br/mais-vendidos` (~180 produtos ranqueados, 1 GET) e `amazon.com.br/gp/bestsellers/*` (best-effort).
- Nota, nº de avaliações, "compras no mês" e selo "Mais vendido" viram **multiplicador de popularidade** no score (nota < 3,8 penaliza). Peso em `POPULARITY_WEIGHT`.

## Black Friday

`SEASON_MODE=auto` (padrão) detecta o calendário: **Black November** (1/nov →), **semana da BF** (terça → domingo) e **Cyber Monday**.
Na temporada: coleta a cada `BF_CRAWL_INTERVAL_MIN` / `BF_PEAK_CRAWL_INTERVAL_MIN`, teto `BF_MAX_NOTIFICATIONS_PER_CYCLE`, termos extras `BF_QUERIES`, selo 🖤 no Telegram e envio espaçado (`TELEGRAM_MIN_INTERVAL_MS`, ~20 msg/min).
Ciclos nunca se sobrepõem (POST `/api/crawl` durante um ciclo → 409). `SEASON_MODE=force` testa o modo BF a qualquer momento.

## Rodar local

```bash
bun install
cp .env.example .env   # preencha TELEGRAM_* e LITELLM_*

# job único (cron): coleta + detecta + notifica
RUN_MODE=CRAWL bun run src/index.ts

# servidor: API + dashboard em http://localhost:3005
RUN_MODE=SERVER bun run src/index.ts
```

- `RUN_MODE=CRAWL`: roda **um** ciclo e sai (bom para CronJob).
- `RUN_MODE=SERVER`: sobe API + dashboard e, se `CRAWL_INTERVAL_MIN > 0`, agenda
  ciclos internos (o intervalo é recalculado a cada ciclo e acelera na Black Friday).

### Docker

```bash
docker build -t radar-ofertas .
docker run --rm -p 3005:3005 --env-file .env -v radar-data:/data radar-ofertas
```

A imagem roda como usuário não-root (`app`), usa o Chromium do sistema para o
fallback de browser e grava o SQLite em `/data` (monte um volume).

### Telegram

1. Crie o bot no @BotFather e preencha `TELEGRAM_BOT_TOKEN`.
2. Adicione o bot como **admin** do canal/grupo e preencha `TELEGRAM_CHAT_ID`.
3. Cada ciclo envia até o teto de mensagens (`MAX_NOTIFICATIONS_PER_CYCLE`, ou
   `BF_MAX_NOTIFICATIONS_PER_CYCLE` na temporada), espaçadas por `TELEGRAM_MIN_INTERVAL_MS`.
4. Os botões 👍/👎 viram feedback de recomendação via `POST /api/feedback`
   (dashboard) ou long-polling com `TELEGRAM_POLL_CALLBACKS=true`. Deixe `false`
   se o mesmo bot for usado por outro consumidor (n8n), para evitar 409.

Dashboard (`public/index.html`, sem build):

- **Radar ao vivo** — cada oferta é um ponto; quanto mais perto do centro, maior o desconto.
- **Achado do momento** rotativo, KPIs (economia somada, bugs de preço, menor preço) que viram filtro.
- Cards com faixa histórica mín–máx, sparkline, anel de score, favoritos e 👍/👎 (alimenta a recomendação).
- Gaveta de detalhe com gráfico de histórico, motivos da oferta e navegação ←/→.
- Filtros por loja, categoria, desconto mínimo, favoritos, menor preço, bug e em queda; grade ou lista.
- Paleta de comandos (`Ctrl/⌘ K`) e atalhos (`/`, `G`, `T`, `R`, `?`); tema claro/escuro; mobile.

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | healthcheck |
| GET | `/api/deals?limit=N` | ofertas recentes |
| GET | `/api/top?hours=24&limit=20` | melhores ofertas (1 por produto) por score |
| GET | `/api/season` | fase da temporada (Black Friday) e ajustes ativos |
| GET | `/api/stats` | feedback agregado por categoria |
| POST | `/api/feedback` | `{ "dealId": 1, "vote": 1 \| -1 }` |
| POST | `/api/crawl` | dispara um ciclo manualmente (409 se já houver um rodando) |

## Testes

```bash
bun test   # sem rede: detecção, recomendação, parsers (fixtures) e ensaio do ciclo Black Friday
```

## Deploy (cluster k3s via app-charts / ArgoCD)

- Imagem `ghcr.io/juninmd/radar-ofertas:latest` construída por GitHub Actions.
- Manifests em `app-charts/radar-ofertas/` (Deployment + Service + Ingress +
  CronJob de coleta + ExternalSecret + PVC). LiteLLM interno em
  `http://litellm.ai.svc.cluster.local:4000/v1`.

## Variáveis principais

Todas estão comentadas em `.env.example`. Resumo por grupo:

| Grupo | Variáveis |
|---|---|
| Execução | `RUN_MODE`, `PORT`, `DB_PATH`, `LOG_LEVEL`, `CRAWL_INTERVAL_MIN` |
| Coleta | `CRAWL_SOURCES`, `CRAWL_QUERIES`, `MAX_PER_QUERY`, `CRAWL_CONCURRENCY`, `BESTSELLER_SOURCES` |
| Detecção | `MIN_HISTORY_POINTS`, `MIN_HISTORY_HOURS`, `Z_THRESHOLD`, `MIN_DISCOUNT_PCT`, `NOTIFY_SCORE`, `PRICE_BUG_DISCOUNT_PCT`, `LISTPRICE_MIN_DISCOUNT_PCT`, `LISTPRICE_NOTIFY`, `REDEAL_DROP_PCT`, `MARKET_TOLERANCE_PCT`, `POPULARITY_WEIGHT` |
| Envio | `MAX_NOTIFICATIONS_PER_CYCLE`, `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_POLL_CALLBACKS`, `TELEGRAM_MIN_INTERVAL_MS` |
| Black Friday | `SEASON_MODE` (`auto`/`off`/`force`), `BF_BASELINE_CUTOFF`, `BF_CRAWL_INTERVAL_MIN`, `BF_PEAK_CRAWL_INTERVAL_MIN`, `BF_MAX_NOTIFICATIONS_PER_CYCLE`, `BF_QUERIES` |
| IA / banco | `LITELLM_ENABLED`, `LITELLM_API_BASE`, `LITELLM_API_KEY`, `LITELLM_MODEL`, `LITELLM_TIMEOUT_MS`, `CLUSTER_DATABASE_URL` |
