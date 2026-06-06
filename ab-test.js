// ab-test.js — Lab 1: A/B test Haiku vs Sonnet vs GPT | Variante: Resúmenes Ejecutivos

import "dotenv/config";

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import OpenAI from "openai";

const anthropic = new Anthropic();
const openai = new OpenAI();

// Tarifas USD por millón de tokens (verificar en docs.claude.com / openai.com/pricing)
const PRICES = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

// Multiplicadores de prompt caching de Anthropic (sobre el precio de input):
//   - lectura desde caché: 0.1x   - escritura en caché (TTL 5 min): 1.25x
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// Tope de salida ajustado al tamaño real de un resumen de ~90 palabras.
// Estimación: ~90 palabras en español ≈ ~160 tokens; 180 deja margen sin truncar.
const MAX_TOKENS = 180;

// Cada modelo declara su proveedor para enrutar la llamada en generate()
const MODELS = [
  { name: "claude-haiku-4-5", provider: "anthropic" },
  { name: "claude-sonnet-4-6", provider: "anthropic" },
  { name: "gpt-4o-mini", provider: "openai" },
];

// Variante: Resúmenes Ejecutivos de proyectos (system prompt acortado)
const SYSTEM = `Sos asistente de gestión de proyectos. Redactá resúmenes ejecutivos claros y profesionales (máx. 90 palabras). Devolvé solo el resumen, sin títulos ni aclaraciones.`;

const ITEMS = [
  "Proyecto: Migración de base de datos a la nube. Estado: 60% completado. Tareas pendientes: testing de performance y capacitación del equipo. Fecha límite: 30 de junio.",
  "Proyecto: Rediseño de la app móvil. Estado: 80% completado. Tareas pendientes: corrección de bugs en iOS y revisión final de UX. Fecha límite: 15 de junio.",
  "Proyecto: Implementación de sistema de pagos. Estado: 35% completado. Tareas pendientes: integración con pasarela de pagos, pruebas de seguridad y documentación. Fecha límite: 31 de julio.",
];

const INSTRUCTION = (item) =>
  `Generá un resumen ejecutivo profesional para el siguiente proyecto:\n\n${item}`;

function costUSD(model, { inTok, outTok, cacheRead = 0, cacheCreate = 0 }) {
  const p = PRICES[model];
  return (
    (inTok / 1e6) * p.input +
    (cacheRead / 1e6) * p.input * CACHE_READ_MULT +
    (cacheCreate / 1e6) * p.input * CACHE_WRITE_MULT +
    (outTok / 1e6) * p.output
  );
}

async function generateAnthropic(model, prompt) {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    // Bloque system marcado para prompt caching (prefijo estable y compartido).
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const u = msg.usage;
  return {
    text,
    inTok: u.input_tokens, // input NO cacheado (precio completo)
    outTok: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0, // servidos desde caché (0.1x)
    cacheCreate: u.cache_creation_input_tokens ?? 0, // escritos a caché (1.25x)
  };
}

async function generateOpenAI(model, prompt) {
  const res = await openai.chat.completions.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
  });
  return {
    text: res.choices[0].message.content ?? "",
    inTok: res.usage.prompt_tokens,
    outTok: res.usage.completion_tokens,
    cacheRead: 0, // OpenAI no usa el caché de Anthropic
    cacheCreate: 0,
  };
}

async function generate({ name, provider }, prompt) {
  const t0 = Date.now();
  const r =
    provider === "openai"
      ? await generateOpenAI(name, prompt)
      : await generateAnthropic(name, prompt);
  const ms = Date.now() - t0;
  return { ...r, ms, cost: costUSD(name, r) };
}

async function main() {
  const rows = [];
  for (const model of MODELS) {
    let totMs = 0,
      totIn = 0,
      totOut = 0,
      totCost = 0,
      totCacheRead = 0,
      totCacheCreate = 0;
    console.log("\n=== " + model.name + " ===");
    for (const item of ITEMS) {
      const r = await generate(model, INSTRUCTION(item));
      totMs += r.ms;
      totIn += r.inTok;
      totOut += r.outTok;
      totCost += r.cost;
      totCacheRead += r.cacheRead;
      totCacheCreate += r.cacheCreate;
      console.log("\n- " + r.text);
      console.log(
        "  (" +
          r.ms +
          " ms | in " +
          r.inTok +
          " / out " +
          r.outTok +
          " tok | caché: " +
          r.cacheRead +
          " leídos / " +
          r.cacheCreate +
          " nuevos | $" +
          r.cost.toFixed(6) +
          ")",
      );
    }
    // Ahorro estimado vs correr sin caché: las lecturas de caché habrían costado
    // input a precio completo (en vez de 0.1x); restamos el sobrecosto de escritura (0.25x extra).
    const p = PRICES[model.name];
    const savingUsd =
      (totCacheRead / 1e6) * p.input * (1 - CACHE_READ_MULT) -
      (totCacheCreate / 1e6) * p.input * (CACHE_WRITE_MULT - 1);
    rows.push({
      model: model.name,
      avg_ms: Math.round(totMs / ITEMS.length),
      total_in: totIn,
      total_out: totOut,
      cache_read_tok: totCacheRead,
      cache_write_tok: totCacheCreate,
      total_cost_usd: Number(totCost.toFixed(6)),
      saving_usd: Number(savingUsd.toFixed(6)),
      cost_per_1k_items_usd: Number(
        ((totCost / ITEMS.length) * 1000).toFixed(2),
      ),
    });
  }
  console.log("\n=== TABLA COMPARATIVA ===");
  console.table(rows);
  fs.writeFileSync("ab-results.json", JSON.stringify(rows, null, 2));
  console.log("\nResultados guardados en ab-results.json");

  // Exportar a CSV
  const csv = [
    "model,avg_ms,total_in,total_out,cache_read_tok,cache_write_tok,total_cost_usd,saving_usd,cost_per_1k_items_usd",
    ...rows.map(
      (r) =>
        `${r.model},${r.avg_ms},${r.total_in},${r.total_out},${r.cache_read_tok},${r.cache_write_tok},${r.total_cost_usd},${r.saving_usd},${r.cost_per_1k_items_usd}`,
    ),
  ].join("\n");
  fs.writeFileSync("ab-results.csv", csv);
  console.log("CSV guardado en ab-results.csv");

  // Gráfico de barras en consola
  console.log("\n=== COSTO vs LATENCIA ===");
  for (const r of rows) {
    const costBar = "█".repeat(Math.round(r.total_cost_usd * 5000));
    const msBar = "░".repeat(Math.round(r.avg_ms / 200));
    console.log(`${r.model}`);
    console.log(`  Costo:    ${costBar} $${r.total_cost_usd}`);
    console.log(`  Latencia: ${msBar} ${r.avg_ms}ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
