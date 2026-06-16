// Classificação leve por palavra-chave (sem custo de IA). Usada p/ recomendação.
const RULES: [string, string[]][] = [
  ["suplementos", ["whey", "creatina", "bcaa", "protein", "albumina", "glutamina", "pré-treino", "pre treino"]],
  ["armazenamento", ["ssd", "nvme", "hd ", "hdd", "pendrive", "cartão", "micro sd", "sd card"]],
  ["perifericos", ["mouse", "teclado", "headset", "monitor", "webcam", "mousepad"]],
  ["moveis-gamer", ["cadeira", "mesa gamer"]],
  ["smart-home", ["echo", "alexa", "lampada", "lâmpada", "smart", "tomada"]],
  ["celulares", ["iphone", "galaxy", "smartphone", "celular", "redmi", "moto g", "xiaomi"]],
  ["computadores", ["notebook", "processador", "ryzen", "intel", "placa de vídeo", "rtx", "memória ram", "ddr4", "ddr5"]],
  ["tv-audio", ["tv ", "smart tv", "soundbar", "fone", "jbl"]],
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
