const https = require("https");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

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

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.mercadopago.com",
          path: "/v1/payments",
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(paymentData)
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => resolve(JSON.parse(data)));
        }
      );
      req.on("error", reject);
      req.write(paymentData);
      req.end();
    });

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
};
