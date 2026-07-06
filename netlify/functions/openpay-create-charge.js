// ============================================================
//  openpay-create-charge.js  —  Netlify Function
//  Crea un cargo SPEI (bank_account) o EFECTIVO (store) en Openpay.
//  El cliente NUNCA ve la llave secreta: vive solo aquí, en el servidor.
//
//  Endpoint (una vez desplegado):
//    https://TU-SITIO.netlify.app/.netlify/functions/openpay-create-charge
//
//  Variables de entorno (Netlify -> Site settings -> Environment variables):
//    OPENPAY_MERCHANT_ID  = mcu1a7seu2rgu8lpnwes
//    OPENPAY_PRIVATE_KEY   = sk_xxxxxxxx   (tu llave PRIVADA de Openpay)
//    OPENPAY_API_BASE     = https://api.openpay.mx        (producción)
//                           https://sandbox-api.openpay.mx (pruebas)
//    ALLOWED_ORIGIN       = https://pago.tiendasvm.com.mx  (tu formulario)
// ============================================================

const MERCHANT_ID = process.env.OPENPAY_MERCHANT_ID;
const PRIVATE_KEY  = process.env.OPENPAY_PRIVATE_KEY;
const API_BASE    = process.env.OPENPAY_API_BASE || "https://api.openpay.mx";
const ORIGIN      = process.env.ALLOWED_ORIGIN   || "*";

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };

  if (!MERCHANT_ID || !PRIVATE_KEY)
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: "Faltan variables de entorno OPENPAY_MERCHANT_ID / OPENPAY_PRIVATE_KEY" }) };

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { method, amount, description, order_id, name, last_name, email, phone_number } = data;

  // --- Validaciones básicas ---
  if (method !== "bank_account" && method !== "store")
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "method debe ser 'bank_account' (SPEI) o 'store' (efectivo)" }) };

  const monto = Number(amount);
  if (!monto || monto <= 0)
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "amount inválido" }) };

  if (!name || !email)
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Faltan datos del cliente (name, email)" }) };

  // Vigencia de la referencia: 3 días naturales
  const due = new Date();
  due.setDate(due.getDate() + 3);

  const payload = {
    method,
    amount: Number(monto.toFixed(2)),
    currency: "MXN",
    description: description || "Compra en VM Tecnología & Accesorios",
    order_id: order_id || `vm-${Date.now()}`,
    due_date: due.toISOString().slice(0, 19), // formato aceptado por Openpay
    customer: {
      name,
      last_name: last_name || "",
      email,
      phone_number: phone_number || "",
    },
  };

  // Autenticación Basic:  usuario = llave secreta, password vacío
  const auth = "Basic " + Buffer.from(PRIVATE_KEY + ":").toString("base64");

  try {
    const resp = await fetch(`${API_BASE}/v1/${MERCHANT_ID}/charges`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(payload),
    });

    const charge = await resp.json();

    if (!resp.ok) {
      // Openpay devuelve description + error_code cuando algo falla
      return {
        statusCode: resp.status,
        headers: cors,
        body: JSON.stringify({ error: charge.description || "Error de Openpay", detalle: charge }),
      };
    }

    const pm = charge.payment_method || {};
    // Recibo SPEI en PDF (solo mientras la transacción está pendiente)
    const dashBase = API_BASE.includes("sandbox")
      ? "https://sandbox-dashboard.openpay.mx"
      : "https://dashboard.openpay.mx";
    const spei_pdf = `${dashBase}/spei-pdf/${MERCHANT_ID}/${charge.id}`;

    // Respuesta limpia para el frontend
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        id: charge.id,
        method: charge.method,
        status: charge.status,          // in_progress hasta que el cliente pague
        amount: charge.amount,
        order_id: charge.order_id,
        due_date: charge.due_date || payload.due_date,
        // SPEI:
        bank: pm.bank || null,
        clabe: pm.clabe || null,
        agreement: pm.agreement || null,
        name: pm.name || null,
        spei_pdf: charge.method === "bank_account" ? spei_pdf : null,
        // Efectivo:
        reference: pm.reference || null,
        barcode_url: pm.barcode_url || null,
      }),
    };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: "No se pudo conectar con Openpay", detalle: String(err) }) };
  }
};
