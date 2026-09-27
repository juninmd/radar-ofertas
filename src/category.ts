// Classificação leve por palavra-chave (sem custo de IA). Usada p/ recomendação.
const RULES: [string, string[]][] = [
  ["suplementos", ["whey", "creatina", "bcaa", "protein", "albumina", "glutamina", "pré-treino", "pre treino", "hipercalorico", "barra de proteina"]],
  ["eletrodomesticos", ["geladeira", "refrigerador", "lavadora", "lava e seca", "fogao", "fogão", "cooktop", "micro-ondas", "microondas", "freezer"]],
  ["roupas", ["camisa", "camiseta", "calca", "calça", "bermuda", "shorts", "tenis", "tênis", "jaqueta", "moletom", "polo", "meia", "cueca"]],
  ["jogos", ["playstation", "ps5", "ps4", "xbox", "nintendo switch", "console", "joy-con", "dualsense", "game ", "jogos"]],
  ["tv-audio", ["tv ", "smart tv", "oled", "qled", "soundbar", "fone", "headphone", "jbl", "4k"]],
  ["eletroportateis", ["air fryer", "fritadeira", "cafeteira", "aspirador", "panela eletrica", "liquidificador", "batedeira", "sanduicheira"]],
  ["ferramentas", ["furadeira", "parafusadeira", "serra", "trena", "jogo de ferramentas", "chave de fenda", "chave phillips", "alicate", "esmerilhadeira"]],
  ["casa-utilidades", ["mop", "filtro de agua", "purificador", "panela de pressao", "varal", "organizad", "ventilador"]],
  ["armazenamento", ["ssd", "nvme", "hd ", "hdd", "pendrive", "cartão", "micro sd", "sd card"]],
  ["perifericos", ["mouse", "teclado", "headset", "monitor", "webcam", "mousepad"]],
  ["moveis-gamer", ["cadeira", "mesa gamer"]],
  ["smart-home", ["echo", "alexa", "lampada", "lâmpada", "smart", "tomada"]],
  ["celulares", ["iphone", "galaxy", "smartphone", "celular", "redmi", "moto g", "xiaomi"]],
  ["computadores", ["notebook", "processador", "ryzen", "intel", "placa de vídeo", "rtx", "memória ram", "ddr4", "ddr5"]],
];

export function classify(title: string): string {
  const t = title.toLowerCase();
  for (const [cat, kws] of RULES) {
    if (kws.some((k) => t.includes(k))) return cat;
  }
  return "geral";
}

const STOP = new Set([
  "de", "com", "para", "the", "e", "a", "o", "em", "do", "da", "kg", "ml", "g",
  "un", "und", "pç", "gb", "tb", "polegadas", "preto", "branco", "original",
]);

// extrai tokens significativos do título p/ casar com feedback
export function keywords(title: string, max = 6): string[] {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
    .slice(0, max);
}

// Assinatura normalizada do produto p/ evitar ofertas duplicadas de títulos parecidos
export function titleSignature(title: string): string {
  const tokens = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return Array.from(new Set(tokens)).sort().slice(0, 5).join(" ");
}

const USEFUL_KEYWORDS = new Set([
  "air fryer", "fritadeira", "cafeteira", "aspirador", "panela eletrica", "liquidificador",
  "furadeira", "parafusadeira", "ferramentas", "mop", "purificador", "filtro", "ventilador",
  "monitor", "teclado", "mouse", "headset", "cadeira", "ssd", "nvme", "notebook",
  "alexa", "echo", "smartphone", "celular", "power bank", "carregador",
  "whey", "creatina", "geladeira", "lavadora", "fogao", "cooktop", "smart tv", "ps5", "xbox", "nintendo switch", "tenis"
]);

const LOW_UTILITY_KEYWORDS = [
  "capa", "case", "pelicula", "película", "adesivo", "chaveiro", "cabo simples", "cordao", "cordão",
  "capinha", "pulseira silicone", "brinquedo plastico"
];

export function utilityScore(title: string, category: string): { score: number; reason: string } {
  const t = title.toLowerCase();
  for (const low of LOW_UTILITY_KEYWORDS) {
    if (t.includes(low)) {
      return { score: 0.2, reason: `baixa-utilidade: ${low}` };
    }
  }

  const highCat = [
    "suplementos",
    "eletrodomesticos",
    "roupas",
    "jogos",
    "tv-audio",
    "eletroportateis",
    "ferramentas",
    "casa-utilidades",
    "computadores",
    "armazenamento",
    "smart-home"
  ].includes(category);
  const matchedUseful = Array.from(USEFUL_KEYWORDS).some(k => t.includes(k));

  if (highCat || matchedUseful) {
    return { score: 1.2, reason: `alta-utilidade (${category})` };
  }

  return { score: 1.0, reason: "utilidade-padrao" };
}

