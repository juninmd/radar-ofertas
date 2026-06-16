import type { ScrapedProduct } from "../types.ts";

// Catálogo sintético determinístico usado quando os sites bloqueiam o crawler
// (anti-bot). Garante que o pipeline completo — histórico, detecção de oferta,
// Telegram, IA e recomendação — seja observável e testável fim-a-fim.
// O preço oscila ao redor de uma base; a cada N ticks ocorre um "mergulho"
// que deve ser detectado como oferta real.
const BASE: Record<string, { title: string; base: number }[]> = {
  "whey protein": [
    { title: "Whey Protein Concentrado 900g Growth Supplements", base: 89.9 },
    { title: "Whey Protein Isolado 900g Max Titanium Baunilha", base: 159.9 },
  ],
  creatina: [{ title: "Creatina Monohidratada 300g Integralmedica", base: 99.9 }],
  "ssd nvme": [
    { title: "SSD 1TB NVMe M.2 Kingston NV2 PCIe 4.0", base: 399.9 },
    { title: "SSD 480GB Sandisk Plus SATA", base: 199.9 },
  ],
  "monitor gamer": [
    { title: "Monitor Gamer 24 165Hz LG UltraGear Full HD", base: 899.9 },
  ],
  "cadeira gamer": [
    { title: "Cadeira Gamer ThunderX3 EC3 Reclinável", base: 1199.9 },
  ],
  "echo dot": [{ title: "Echo Dot 5 Geração Alexa Smart Speaker", base: 349.9 }],
};

function priceFor(base: number, tick: number, salt: number): number {
  // oscilação suave + mergulho a cada 4 ticks
  const wave = Math.sin((tick + salt) * 1.3) * base * 0.04;
  const dip = (tick + salt) % 4 === 0 ? -base * 0.22 : 0;
  return Math.round((base + wave + dip) * 100) / 100;
}

export function demoProducts(query: string, source: string, tick: number): ScrapedProduct[] {
  const items = BASE[query] ?? [{ title: `${query}`, base: 100 }];
  const salt = source.length;
  return items.map((it, i) => {
    const externalId = `demo-${source}-${query}-${i}`.replace(/\s+/g, "-");
    let url: string;
    // construct plausible URLs matching real site patterns
    if (source === "mercadolivre") {
      url = `https://www.mercadolivre.com.br/p/MLB${String(1000000 + i).slice(-6)}`;
    } else if (source === "amazon") {
      url = `https://www.amazon.com.br/dp/B0${String(100000 + i).slice(-8)}`;
    } else {
      url = `https://www.magazineluiza.com.br/busca/${encodeURIComponent(query)}/${i}`;
    }
    return {
      source,
      externalId,
      title: `${it.title}`,
      url,
      image: `https://picsum.photos/seed/${encodeURIComponent(externalId)}/600/600`,
      price: priceFor(it.base * (source === "amazon" ? 1.03 : source === "magalu" ? 0.98 : 1), tick, salt + i),
      query,
    } satisfies ScrapedProduct;
  });
}
