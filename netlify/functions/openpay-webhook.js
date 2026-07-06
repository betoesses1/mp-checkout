// ============================================================
//  openpay-webhook.js  —  Netlify Function
//  Recibe las notificaciones de Openpay:
//   1) type "verification"  -> guarda el verification_code (lo verás en los
//      logs de Netlify) y devuelve 200. Ese código lo capturas en el
//      Dashboard de Openpay para activar el webhook.
//   2) pago confirmado (charge.succeeded / spei.received) -> marca el pedido
//      de Shopify como pagado.
//
//  URL a registrar en Openpay:
//    https://TU-SITIO.netlify.app/.netlify/functions/openpay-webhook
//
//  Variables de entorno opcionales (para marcar Shopify pagado):
//    SHOPIFY_STORE        = tiendasvm   (solo el handle; el código le agrega .myshopify.com)
//    SHOPIFY_API_KEY      = shpat_xxx   (token de tu app openpay-integration-2)
// ============================================================

// Anti-duplicados en memoria (Openpay puede reenviar la misma notificación).
// Para producción seria conviene una base/KV; en la práctica esto reduce dobles.
const procesados = new Set();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let noti;
  try {
    noti = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "JSON inválido" };
  }

  const tipo = noti.type;

  // 1) VERIFICACIÓN del webhook -----------------------------------------
  if (tipo === "verification") {
    console.log("👉 OPENPAY VERIFICATION CODE:", noti.verification_code);
    // Devolvemos 200; copia ese código de los logs y pégalo en el Dashboard.
    return { statusCode: 200, body: JSON.stringify({ verification_code: noti.verification_code }) };
  }

  // 2) PAGO CONFIRMADO ---------------------------------------------------
  const tx = noti.transaction || {};
  const esPagoOk =
    (tipo === "charge.succeeded" || tipo === "spei.received") &&
    (tx.status === "completed" || tipo === "spei.received");

  if (esPagoOk) {
    if (tx.id && procesados.has(tx.id)) {
      return { statusCode: 200, body: "duplicado ignorado" };
    }
    if (tx.id) procesados.add(tx.id);

    console.log(`✅ Pago confirmado. order_id=${tx.order_id} método=${tx.method} monto=${tx.amount}`);

    // Marca el pedido de Shopify como pagado (si configuraste las variables)
    try {
      await marcarShopifyPagado(tx.order_id);
    } catch (e) {
      console.error("No se pudo marcar Shopify:", String(e));
      // devolvemos 200 igual para que Openpay no reintente en bucle;
      // el pago YA está confirmado, el marcado se puede reintentar manual.
    }
    return { statusCode: 200, body: "ok" };
  }

  // Cualquier otro evento: acusamos recibo para que Openpay no reintente.
  console.log("Evento recibido (sin acción):", tipo);
  return { statusCode: 200, body: "ok" };
};

// ---- Helper: marcar pedido de Shopify como pagado ----
async function marcarShopifyPagado(orderId) {
  const store = process.env.SHOPIFY_STORE;
  const token = process.env.SHOPIFY_API_KEY;
  if (!store || !token || !orderId) return; // sin config, se omite

  // Suponemos que order_id del cargo == ID numérico del pedido de Shopify.
  // Ajusta esta lógica a cómo tú generas order_id al crear el cargo.
  const api = `https://${store}.myshopify.com/admin/api/2026-04`;

  // 1) Crea una transacción "sale" pagada sobre el pedido
  const resp = await fetch(`${api}/orders/${orderId}/transactions.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ transaction: { kind: "sale", status: "success" } }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Shopify ${resp.status}: ${t}`);
  }
  console.log("Shopify: pedido marcado como pagado", orderId);
}
