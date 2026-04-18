const https = require("https");

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
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

  if (event.httpMethod === "GET" && event.queryStringParameters && event.queryStringParameters.order_name) {
    try {
      const orderName = event.queryStringParameters.order_name;
      const shopifyToken = process.env.SHOPIFY_API_SECRET;
      const shopifyStore = process.env.SHOPIFY_STORE;

      const result = await httpsRequest({
        hostname: shopifyStore,
        path: `/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=total_price,name,currency`,
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": shopifyToken,
          "Content-Type": "application/json"
        }
      });

      if (result.orders && result.orders.length > 0) {
        const order = result.orders[0];
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            total: parseFloat(order.total_price),
            order_name: order.name,
            currency: order.currency
          })
        };
      } else {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Orden no encontrada" })
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Error consultando orden" })
      };
    }
  }

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

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: result.status,
          status_detail: result.status_detail,
          id: result.id
        })
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Error procesando el pago" })
      };
    }
  }

  return { statusCode: 405, headers, body: "Method Not Allowed" };
};
