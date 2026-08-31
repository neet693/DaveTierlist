// api/admin-login.js

export default async function handler(req, res) {
  // =========================================================
  // METHOD
  // =========================================================

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  // =========================================================
  // CORS
  // =========================================================

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  try {
    // =======================================================
    // BODY
    // =======================================================

    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
    }

    body = body || {};

    const password = body.password;

    // =======================================================
    // ENV
    // =======================================================

    const expectedPassword =
      process.env.ADMIN_PASSWORD;

    if (!expectedPassword) {
      console.error(
        "ADMIN_PASSWORD is not configured in Vercel."
      );

      return res.status(500).json({
        success: false,
        message:
          "Admin authentication is not configured on the server."
      });
    }

    // =======================================================
    // VALIDATION
    // =======================================================

    if (
      typeof password !== "string" ||
      password.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Password is required."
      });
    }

    // =======================================================
    // PASSWORD CHECK
    // =======================================================

    if (password !== expectedPassword) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password."
      });
    }

    // =======================================================
    // SUCCESS
    // =======================================================

    return res.status(200).json({
      success: true
    });

  } catch (error) {
    console.error(
      "Admin login error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
}
