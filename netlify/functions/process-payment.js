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

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;

  // POST: crear preferencia de Checkout Pro
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body);

      // Crear preferencia de pago
      const preferenceData = JSON.stringify({
        items: [{
          title: body.description || "Pedido VM Tecnología",
          quantity: 1,
          unit_price: body.amount,
          currency_id: "MXN"
        }],
        payer: {
          email: body.email || "cliente@ejemplo.com"
        },
        external_reference: body.order_name || "",
        back_urls: {
          success: body.back_url || "https://tiendasvm.com",
          failure: "https://pagos.tiendasvm.com.mx/indexmp.html",
          pending: body.back_url || "https://tiendasvm.com"
        },
        auto_return: "approved",
        statement_descriptor: "VM Tecnologia",
        notification_url: "https://pagos.tiendasvm.com.mx/.netlify/functions/process-payment"
      });

      const result = await httpsRequest({
        hostname: "api.mercadopago.com",
        path: "/checkout/preferences",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(preferenceData)
        }
      }, preferenceData);

      if (result.body.init_point) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            init_point: result.body.init_point,
            id: result.body.id
          })
        };
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "No se pudo crear la preferencia", details: result.body })
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Error creando preferencia" })
      };
    }
  }

  return { statusCode: 405, headers, body: "Method Not Allowed" };
};
