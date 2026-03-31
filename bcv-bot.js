// =============================================
// BOT TELEGRAM - TASA BCV CON CLAUDE AI
// =============================================
// Instalar dependencias:
// npm install node-telegram-bot-api axios node-cron dotenv @anthropic-ai/sdk

import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Suscriptores en memoria (en producción usa una DB como SQLite o MongoDB)
const suscriptores = new Set();
let ultimaTasa = null;

// ── 1. Obtener tasa BCV ────────────────────────────────────────
async function obtenerTasaBCV() {
  const { data } = await axios.get("https://ve.dolarapi.com/v1/dolares/oficial");
  return {
    tasa: parseFloat(data.promedio).toFixed(2),
    fecha: data.fechaActualizacion,
  };
}

// ── 2. Generar mensaje (sin IA por ahora) ─────────────────────
async function generarMensaje(tasaActual, tasaAnterior) {
  const ahora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });

  if (!tasaAnterior) {
    return `💵 Tasa BCV oficial\n` +
           `Bs. ${tasaActual} por dólar\n` +
           `📅 ${ahora}`;
  }

  const diff = (tasaActual - tasaAnterior).toFixed(2);
  const pct  = ((tasaActual - tasaAnterior) / tasaAnterior * 100).toFixed(2);
  const flecha = diff > 0 ? "📈 Subió" : "📉 Bajó";

  return `🔔 Cambio en la tasa BCV\n` +
         `${flecha} Bs. ${Math.abs(diff)} (${pct > 0 ? "+" : ""}${pct}%)\n` +
         `💵 Nueva tasa: Bs. ${tasaActual}\n` +
         `📅 ${ahora}`;
}

// ── 3. Enviar alerta a todos los suscriptores ──────────────────
async function notificarSuscriptores(mensaje) {
  for (const chatId of suscriptores) {
    try {
      await bot.sendMessage(chatId, mensaje);
    } catch (err) {
      console.error(`❌ Error enviando a ${chatId}:`, err.message);
      suscriptores.delete(chatId); // Eliminar si el usuario bloqueó el bot
    }
  }
}

// ── 4. Flujo principal de verificación ────────────────────────
async function verificarYNotificar() {
  try {
    console.log("🔍 Verificando tasa BCV...");
    const { tasa, fecha } = await obtenerTasaBCV();

    if (tasa !== ultimaTasa) {
      console.log(`📈 Cambio detectado: ${ultimaTasa} → ${tasa}`);
      const mensaje = await generarMensaje(tasa, ultimaTasa);
      await notificarSuscriptores(mensaje);
      ultimaTasa = tasa;
    } else {
      console.log(`✔️  Sin cambios. Tasa actual: Bs. ${tasa} (${fecha})`);
    }
  } catch (err) {
    console.error("❌ Error en verificación:", err.message);
  }
}

// ── 5. Cron Job (cada 2 horas, lunes a viernes, horario Caracas) 
cron.schedule("0 8,10,12,14,16,18 * * 1-5", verificarYNotificar, {
  timezone: "America/Caracas",
});

// ── 6. Comandos del bot ────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const nombre = msg.from.first_name || "usuario";
  await bot.sendMessage(msg.chat.id,
    `👋 Hola ${nombre}! Soy el bot de tasas BCV 🇻🇪\n\n` +
    `Comandos disponibles:\n` +
    `/tasa — Ver tasa actual del dólar BCV\n` +
    `/suscribir — Recibir alertas automáticas\n` +
    `/cancelar — Dejar de recibir alertas\n` +
    `/ayuda — Ver este menú`
  );
});

bot.onText(/\/tasa/, async (msg) => {
  try {
    await bot.sendMessage(msg.chat.id, "⏳ Consultando tasa BCV...");
    const { tasa, fecha } = await obtenerTasaBCV();
    const mensaje = await generarMensaje(tasa, null);
    await bot.sendMessage(msg.chat.id, mensaje);
  } catch (err) {
    await bot.sendMessage(msg.chat.id, "❌ No pude obtener la tasa. Intenta más tarde.");
  }
});

bot.onText(/\/suscribir/, async (msg) => {
  const chatId = msg.chat.id;
  if (suscriptores.has(chatId)) {
    await bot.sendMessage(chatId, "✅ Ya estás suscrito. Te avisamos cuando cambie la tasa.");
  } else {
    suscriptores.add(chatId);
    await bot.sendMessage(chatId,
      "🔔 ¡Suscrito! Te notificaremos cada vez que cambie la tasa del dólar BCV.\n" +
      "Usa /cancelar para desuscribirte."
    );
  }
});

bot.onText(/\/cancelar/, async (msg) => {
  const chatId = msg.chat.id;
  suscriptores.delete(chatId);
  await bot.sendMessage(chatId, "🔕 Te has desuscrito. Usa /suscribir para volver a activar las alertas.");
});

bot.onText(/\/ayuda/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📋 Comandos disponibles:\n\n` +
    `/tasa — Ver tasa actual del dólar BCV\n` +
    `/suscribir — Recibir alertas automáticas\n` +
    `/cancelar — Dejar de recibir alertas\n` +
    `/ayuda — Ver este menú`
  );
});

// ── Inicio ─────────────────────────────────────────────────────
console.log("🤖 Bot iniciado con polling...");
verificarYNotificar(); // Verificar tasa al arrancar