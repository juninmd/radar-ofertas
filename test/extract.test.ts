import { describe, expect, it } from "bun:test";
import { extractProductDescription } from "../src/crawlers/base.ts";

describe("extractProductDescription", () => {
  it("extrai texto e markdown de página de produto em HTML", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Monitor Gamer 144Hz IPS - Loja</title></head>
        <body>
          <nav><a href="/">Home</a></nav>
          <article>
            <h1>Monitor Gamer 144Hz IPS</h1>
            <p>O monitor perfeito para jogos competitivos com taxa de atualização de 144Hz e painel IPS com cores vibrantes.</p>
            <p>Possui conexões DisplayPort e HDMI, suporte ajustável e compatibilidade G-Sync.</p>
          </article>
          <footer>Todos os direitos reservados</footer>
        </body>
      </html>
    `;
    const res = extractProductDescription(html, { baseUrl: "https://loja.com.br/produto/123" });
    expect(res).not.toBeNull();
    expect(res?.title).toContain("Monitor Gamer");
    expect(res?.contentMarkdown).toContain("painel IPS");
    expect(res?.contentMarkdown).toContain("DisplayPort");
  });

  it("retorna null para html vazio", () => {
    expect(extractProductDescription("")).toBeNull();
  });
});
