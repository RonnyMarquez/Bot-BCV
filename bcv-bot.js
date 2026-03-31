// =============================================
// BOT TELEGRAM - BCV + BINANCE P2P
// =============================================
// npm install node-telegram-bot-api axios node-cron dotenv

import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const suscriptores = new Set();

let ultimasTasas  = { bcv: null, binance: null };
let tasasApertura = null;
let tasasCierre   = null;

// ── 1. Obtener tasa Dólar BCV ──────────────────────────────────
async function obtenerDolarBCV() {
  const { data } = await axios.get("https://ve.dolarapi.com/v1/dolares/oficial");
  return parseFloat(data.promedio).toFixed(2);
}

// ── 2. Obtener promedio P2P Binance (USDT/VES - Venta) ─────────
async function obtenerBinanceP2P() {
  const { data } = await axios.post(
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    { asset: "USDT", fiat: "VES", merchantCheck: false, page: 1, publisherType: null, rows: 10, tradeType: "SELL" },
    { headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" } }
  );
  const precios = data.data.map(d => parseFloat(d.adv.price));
  const promedio = precios.reduce((a, b) => a + b, 0) / precios.length;
  return promedio.toFixed(2);
}

// ── 3. Obtener todas las tasas ─────────────────────────────────
async function obtenerTodasLasTasas() {
  const [bcv, binance] = await Promise.all([
    obtenerDolarBCV().catch(e => { console.error("❌ Error Dólar BCV:", e.message); return null; }),
    obtenerBinanceP2P().catch(e => { console.error("❌ Error Binance P2P:", e.message); return null; }),
  ]);
  console.log("📊 Tasas obtenidas:", { bcv, binance });
  return { bcv, binance };
}

// ── 4. Construir mensaje ───────────────────────────────────────
// nombre es opcional, si se pasa se incluye en el saludo
function construirMensaje(tasas, anteriores, nombre = null) {
  const ahora = new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" });
  const saludo = nombre ? `Estas son las tasas actuales ${nombre} 💖` : `💱 Tasas actuales`;

  function indicador(actual, anterior) {
    if (!anterior) return "";
    const diff = (actual - anterior).toFixed(2);
    if (diff > 0) return ` 📈 +${diff}`;
    if (diff < 0) return ` 📉 ${diff}`;
    return " ➡️ sin cambio";
  }

  return (
    `${saludo}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💵 Dólar BCV:     Bs. ${tasas.bcv}${indicador(tasas.bcv, anteriores.bcv)}\n` +
    `🔶 USDT Binance:  Bs. ${tasas.binance}${indicador(tasas.binance, anteriores.binance)}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📅 ${ahora}`
  );
}

// ── 5. Verificar cambios y notificar ──────────────────────────
async function verificarYNotificar() {
  try {
    console.log("🔍 Verificando tasas...");
    const tasas = await obtenerTodasLasTasas();
    const cambio = tasas.bcv !== ultimasTasas.bcv || tasas.binance !== ultimasTasas.binance;

    if (cambio) {
      console.log("📈 Cambio detectado:", tasas);
      const mensaje = construirMensaje(tasas, ultimasTasas); // sin nombre en alertas automáticas
      for (const chatId of suscriptores) {
        try { await bot.sendMessage(chatId, mensaje); }
        catch (e) { suscriptores.delete(chatId); }
      }
      ultimasTasas = tasas;
    } else {
      console.log("✔️  Sin cambios.", tasas);
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

// ── 6. Mensaje de apertura (7:55am) ───────────────────────────
async function mensajeApertura() {
  try {
    const tasas = await obtenerTodasLasTasas();
    tasasApertura = tasas;
    ultimasTasas  = tasas;

    function comparar(actual, anterior, nombre) {
      if (!anterior) return `${nombre}: Bs. ${actual}`;
      const pct = ((actual - anterior) / anterior * 100).toFixed(2);
      const dir = pct > 0 ? `📈 +${pct}% vs ayer` : pct < 0 ? `📉 ${pct}% vs ayer` : `➡️ igual que ayer`;
      return `${nombre}: Bs. ${actual}  ${dir}`;
    }

    const msg =
      `🌅 Buenos días alegria! Así amanecieron las tasas hoy ${nombre}:\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💵 ${comparar(tasas.bcv,     tasasCierre?.bcv,     "Dólar BCV")}\n` +
      `🔶 ${comparar(tasas.binance, tasasCierre?.binance, "USDT Binance")}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📅 ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}`;

    for (const chatId of suscriptores) {
      try { await bot.sendMessage(chatId, msg); }
      catch (e) { suscriptores.delete(chatId); }
    }
    console.log("🌅 Mensaje de apertura enviado.");
  } catch (err) {
    console.error("❌ Error en apertura:", err.message);
  }
}

// ── 7. Mensaje de cierre (6:05pm) ─────────────────────────────
async function mensajeCierre() {
  try {
    const tasas = await obtenerTodasLasTasas();
    tasasCierre = tasas;

    function comparar(actual, apertura, nombre) {
      if (!apertura) return `${nombre}: Bs. ${actual}`;
      const pct = ((actual - apertura) / apertura * 100).toFixed(2);
      const dir = pct > 0 ? `📈 +${pct}% vs apertura` : pct < 0 ? `📉 ${pct}% vs apertura` : `➡️ sin cambio en el día`;
      return `${nombre}: Bs. ${actual}  ${dir}`;
    }

    const msg =
      `🌙 Buenas noches ${nombre}, es hora de dormir! Así cerró el día:\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💵 ${comparar(tasas.bcv,     tasasApertura?.bcv,     "Dólar BCV")}\n` +
      `🔶 ${comparar(tasas.binance, tasasApertura?.binance, "USDT Binance")}\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📅 ${new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}`;

    for (const chatId of suscriptores) {
      try { await bot.sendMessage(chatId, msg); }
      catch (e) { suscriptores.delete(chatId); }
    }
    console.log("🌙 Mensaje de cierre enviado.");
  } catch (err) {
    console.error("❌ Error en cierre:", err.message);
  }
}

// ── 8. Cron Jobs ──────────────────────────────────────────────
cron.schedule("0 8,10,12,14,16,18 * * 1-5", verificarYNotificar, { timezone: "America/Caracas" });
cron.schedule("55 7 * * 1-5", mensajeApertura, { timezone: "America/Caracas" });
cron.schedule("5 18 * * 1-5", mensajeCierre,   { timezone: "America/Caracas" });

// ── 9. Comandos ───────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const nombre = msg.from.first_name || "usuario";
  await bot.sendMessage(msg.chat.id,
    `👋 Epale ${nombre}! bienvenido a FlashBCV, que deseas hacer? 💖\n\n` +
    `Comandos:\n` +
    `/tasas — Ver las tasas ahora ⚡\n` +
    `/suscribir — Recibir alertas automáticas 🔔\n` +
    `/cancelar — Dejar de recibir alertas 🔕\n` +
    `/ayuda — Ver este menú ℹ️`
  );
});

bot.onText(/\/tasas/, async (msg) => {
  const nombre = msg.from.first_name || "usuario";
  try {
    await bot.sendMessage(msg.chat.id, "⏳ Espera estoy consultando...");
    const tasas = await obtenerTodasLasTasas();
    // ✅ Pasamos el nombre como tercer parámetro
    const mensaje = construirMensaje(tasas, ultimasTasas, nombre);
    await bot.sendMessage(msg.chat.id, mensaje);
    ultimasTasas = tasas;
  } catch (err) {
    await bot.sendMessage(msg.chat.id, `❌ Error: ${err.message}`);
    console.error("❌ Error /tasas:", err.message);
  }
});

bot.onText(/\/suscribir/, async (msg) => {
  const chatId = msg.chat.id;
  if (suscriptores.has(chatId)) {
    await bot.sendMessage(chatId, "✅ Ya estás suscrito. Te avisaré cuando actualicen las tasas.");
  } else {
    suscriptores.add(chatId);
    await bot.sendMessage(chatId,
      "🔔 ¡Te has suscrito! Tranqui, te notificaré cuando cambien las tasas.\n" +
      "Usa /cancelar para desuscribirte."
    );
  }
});

bot.onText(/\/cancelar/, async (msg) => {
  suscriptores.delete(msg.chat.id);
  await bot.sendMessage(msg.chat.id, "🔕 Desuscrito. Usa /suscribir para volver a activar las alertas.");
});

bot.onText(/\/ayuda/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📋 Comandos:\n\n` +
    `/tasas — Ver todas las tasas ahora ⚡\n` +
    `/suscribir — Recibir alertas automáticas 🔔\n` +
    `/cancelar — Dejar de recibir alertas 🔕\n` +
    `/ayuda — Ver este menú ℹ️`
  );
});

// ── Inicio ─────────────────────────────────────────────────────
console.log("🤖 Bot iniciado con polling...");
verificarYNotificar();