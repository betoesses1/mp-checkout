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

async function marcarPedidoPagado(orderName, mpPaymentId) {
  const shopifyStore = process.env.SHOPIFY_STORE;
  const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;

  // Buscar la orden por nombre
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

  // Marcar como pagado con transaction
  const transactionData = JSON.stringify({
    transaction: {
      kind: "capture",
      status: "success",
      amount: order.total_price,
      currency: order.currency,
      gateway: "Mercado Pago",
      source_name: "Mercado Pago",
      message: `Pago aprobado MP ID: ${mpPaymentId}`
    }
  });

  await httpsRequest({
    hostname: shopifyStore,
    path: `/admin/api/2024-01/orders/${orderId}/transactions.json`,
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": shopifyToken,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(transactionData)
    }
  }, transactionData);

  return true;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // GET: consultar total de orden
  if (event.httpMethod === "GET" && event.queryStringParameters?.order_name) {
    try {
      const shopifyStore = process.env.SHOPIFY_STORE;
      const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
      const orderName = event.queryStringParameters.order_name;

      const result = await httpsRequest({
        hostname: shopifyStore,
        path: `/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=total_price,name,currency`,
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json"
        }
      });

      if (result.body.orders && result.body.orders.length > 0) {
        const order = result.body.orders[0];
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            total: parseFloat(order.total_price),
            order_name: order.name,
            currency: order.currency
          })
        };
      }
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Orden no encontrada" }) };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Error consultando orden" }) };
    }
  }

  // POST: procesar pago con Mercado Pago
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body);
      const accessToken = process.env.MP_ACCESS_TOKEN;

      const paymentData = JSON.stringify({
        token: body.token,
        issuer_id: body.issuer_id,
        payment_method_id: body.payment_method_id,
        transaction_amount: body.transaction_amount,
        installments: body.installments,
        description: body.description || "Pedido VM Tecnología",
        external_reference: body.external_reference || "",
        payer: {
          email: body.payer.email,
          identification: body.payer.identification
        }
      });

      const result = await httpsRequest({
        hostname: "api.mercadopago.com",
        path: "/v1/payments",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(paymentData)
        }
      }, paymentData);

      const payment = result.body;

      // Si el pago fue aprobado, marcar pedido en Shopify
      if (payment.status === "approved" && body.external_reference) {
        await marcarPedidoPagado(body.external_reference, payment.id);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: payment.status,
          status_detail: payment.status_detail,
          id: payment.id
        })
      };
    } catch (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Error procesando el pago" }) };
    }
  }

  return { statusCode: 405, headers, body: "Method Not Allowed" };
};
