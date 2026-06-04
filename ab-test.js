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

// Cada modelo declara su proveedor para enrutar la llamada en generate()
const MODELS = [
  { name: "claude-haiku-4-5", provider: "anthropic" },
  { name: "claude-sonnet-4-6", provider: "anthropic" },
  { name: "gpt-4o-mini", provider: "openai" },
];

// Variante: Resúmenes Ejecutivos de proyectos
const SYSTEM = `Eres un asistente de gestión de proyectos. 
Redactás resúmenes ejecutivos claros y profesionales para compartir con jefes o clientes. 
Respondé solo con el resumen, sin títulos ni aclaraciones. Máximo 120 palabras.`;

const ITEMS = [
  "Proyecto: Migración de base de datos a la nube. Estado: 60% completado. Tareas pendientes: testing de performance y capacitación del equipo. Fecha límite: 30 de junio.",
  "Proyecto: Rediseño de la app móvil. Estado: 80% completado. Tareas pendientes: corrección de bugs en iOS y revisión final de UX. Fecha límite: 15 de junio.",
  "Proyecto: Implementación de sistema de pagos. Estado: 35% completado. Tareas pendientes: integración con pasarela de pagos, pruebas de seguridad y documentación. Fecha límite: 31 de julio.",
];

const INSTRUCTION = (item) =>
  `Generá un resumen ejecutivo profesional para el siguiente proyecto:\n\n${item}`;

function costUSD(model, inTok, outTok) {
  const p = PRICES[model];
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
}

async function generateAnthropic(model, prompt) {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  return {
    text,
    inTok: msg.usage.input_tokens,
    outTok: msg.usage.output_tokens,
  };
}

async function generateOpenAI(model, prompt) {
  const res = await openai.chat.completions.create({
    model,
    max_tokens: 200,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
  });
  return {
    text: res.choices[0].message.content ?? "",
    inTok: res.usage.prompt_tokens,
    outTok: res.usage.completion_tokens,
  };
}

async function generate({ name, provider }, prompt) {
  const t0 = Date.now();
  const { text, inTok, outTok } =
    provider === "openai"
      ? await generateOpenAI(name, prompt)
      : await generateAnthropic(name, prompt);
  const ms = Date.now() - t0;
  return { text, ms, inTok, outTok, cost: costUSD(name, inTok, outTok) };
}

async function main() {
  const rows = [];
  for (const model of MODELS) {
    let totMs = 0,
      totIn = 0,
      totOut = 0,
      totCost = 0;
    console.log("\n=== " + model.name + " ===");
    for (const item of ITEMS) {
      const r = await generate(model, INSTRUCTION(item));
      totMs += r.ms;
      totIn += r.inTok;
      totOut += r.outTok;
      totCost += r.cost;
      console.log("\n- " + r.text);
      console.log(
        "  (" +
          r.ms +
          " ms | in " +
          r.inTok +
          " / out " +
          r.outTok +
          " tok | $" +
          r.cost.toFixed(6) +
          ")",
      );
    }
    rows.push({
      model: model.name,
      avg_ms: Math.round(totMs / ITEMS.length),
      total_in: totIn,
      total_out: totOut,
      total_cost_usd: Number(totCost.toFixed(6)),
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
    "model,avg_ms,total_in,total_out,total_cost_usd,cost_per_1k_items_usd",
    ...rows.map(
      (r) =>
        `${r.model},${r.avg_ms},${r.total_in},${r.total_out},${r.total_cost_usd},${r.cost_per_1k_items_usd}`,
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
