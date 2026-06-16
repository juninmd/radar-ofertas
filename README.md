# 🔥 Radar de Ofertas

Crawler de e-commerce (**Mercado Livre, Amazon, Magazine Luiza**) que rastreia
preços, mantém **histórico**, detecta **promoções reais** (preço abaixo da média
histórica), **notifica no Telegram** e aprende com seu **feedback (👍/👎)** para
priorizar as categorias que você curte. Análise opcional via **LiteLLM**.

Stack: **Bun** + TypeScript + `bun:sqlite` nativo. Zero dependências externas.

## Como funciona

```
crawl (ML/Amazon/Magalu) ──▶ price_history ──▶ detecção de oferta ──▶ score
                                                     │                   │
                          recomendação (feedback) ◀──┘                   ▼
                                                              IA (LiteLLM) + Telegram
```

1. **Coleta** — busca cada termo (`CRAWL_QUERIES`) em cada fonte. Sites têm
   anti-bot agressivo; quando o HTML público é bloqueado, cai num **catálogo
   demo determinístico** (`ALLOW_DEMO_FALLBACK`) para manter o pipeline vivo.
2. **Histórico** — cada execução grava um ponto na série temporal do produto.
3. **Detecção** — com ≥`MIN_HISTORY_POINTS`, compara o preço atual com média e
   desvio-padrão. É oferta se `z ≤ -Z_THRESHOLD` **ou** desconto `≥ MIN_DISCOUNT_PCT`.
4. **Recomendação** — o `score` final = força do desconto × afinidade. A
   afinidade sobe nas categorias/keywords que você **curtiu** (ex.: curtiu whey
   ⇒ próximas promoções de whey pontuam mais ⇒ mais chance de notificar).
5. **Notificação** — se `score ≥ NOTIFY_SCORE`, gera um comentário curto via
   **LiteLLM** e envia ao **Telegram** com botões 👍/👎 inline.

## Rodar local

```bash
bun install
cp .env.example .env   # preencha TELEGRAM_* e LITELLM_*

# job único (cron): coleta + detecta + notifica
RUN_MODE=CRAWL bun run src/index.ts

# servidor: API + dashboard em http://localhost:3005
RUN_MODE=SERVER bun run src/index.ts
```

Dashboard: lista as ofertas e permite curtir/não curtir (alimenta a recomendação).

## API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | healthcheck |
| GET | `/api/deals?limit=N` | ofertas recentes |
| GET | `/api/stats` | feedback agregado por categoria |
| POST | `/api/feedback` | `{ "dealId": 1, "vote": 1 \| -1 }` |
| POST | `/api/crawl` | dispara um ciclo manualmente |

## Testes

```bash
bun test   # detecção de oferta, recomendação, classificação
```

## Deploy (cluster k3s via app-charts / ArgoCD)

- Imagem `ghcr.io/juninmd/radar-ofertas:latest` construída por GitHub Actions.
- Manifests em `app-charts/radar-ofertas/` (Deployment + Service + Ingress +
  CronJob de coleta + ExternalSecret + PVC). LiteLLM interno em
  `http://litellm.ai.svc.cluster.local:4000/v1`.

## Variáveis principais

Veja `.env.example`. Destaques: `CRAWL_QUERIES`, `CRAWL_SOURCES`,
`Z_THRESHOLD`, `MIN_DISCOUNT_PCT`, `NOTIFY_SCORE`, `LITELLM_MODEL`.
