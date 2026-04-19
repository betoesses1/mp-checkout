const https = require("https");

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function obtenerPago(paymentId) {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  return await httpsRequest({
    hostname: "api.mercadopago.com",
    path: `/v1/payments/${paymentId}`,
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
}

async function marcarPedidoPagado(orderName, mpPaymentId, amount) {
  const shopifyStore = process.env.SHOPIFY_STORE;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

  const busqueda = await httpsRequest({
    hostname: shopifyStore,
    path: `/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any`,
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": shopifyToken,
      "Content-Type": "application/json"
    }
  });

  if (!busqueda.body.orders || busqueda.body.orders.length === 0) return false;

  const order = busqueda.body.orders[0];
  const orderId = order.id;

  const transactionData = JSON.stringify({
    transaction: {
      kind: "capture",
      status: "success",
      amount: amount || order.total_price,
      currency: "MXN",
      gateway: "Mercado Pago",
      source_name: "Mercado Pago",
      message: `Pago aprobado MP ID: ${mpPaymentId}`
    }
  });

  const result = await httpsRequest({
    hostname: shopifyStore,
    path: `/admin/api/2024-01/orders/${orderId}/transactions.json`,
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": shopifyToken,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(transactionData)
    }
  }, transactionData);

  return result.status === 201;
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 200, headers, body: "OK" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    // Solo procesar notificaciones de pagos
    if (body.type !== "payment" || !body.data || !body.data.id) {
      return { statusCode: 200, headers, body: "OK" };
    }

    const paymentId = body.data.id;

    // Obtener detalles del pago desde MP
    const pagoResult = await obtenerPago(paymentId);
    const pago = pagoResult.body;

    // Solo procesar pagos aprobados
    if (pago.status !== "approved") {
      return { statusCode: 200, headers, body: "OK" };
    }

    const orderName = pago.external_reference;
    const amount = pago.transaction_amount;

    if (orderName) {
      await marcarPedidoPagado(orderName, paymentId, amount);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (error) {
    return { statusCode: 200, headers, body: "OK" };
  }
};
