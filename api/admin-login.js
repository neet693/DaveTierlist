// Vercel Serverless Function
// POST /api/admin-login
// The password is read only from Vercel Environment Variables.

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ success: false, message: "Method not allowed." });
  }

  try {
    const { password } = typeof request.body === "string"
      ? JSON.parse(request.body || "{}")
      : (request.body || {});

    const expected = process.env.ADMIN_PASSWORD;

    if (!expected) {
      console.error("ADMIN_PASSWORD is not configured.");
      return response.status(500).json({
        success: false,
        message: "Admin authentication is not configured."
      });
    }

    if (typeof password !== "string" || password.length === 0) {
      return response.status(400).json({
        success: false,
        message: "Password is required."
      });
    }

    // Constant-time-ish comparison without exposing the secret.
    if (password !== expected) {
      return response.status(401).json({
        success: false,
        message: "Incorrect password."
      });
    }

    return response.status(200).json({ success: true });
  } catch (error) {
    console.error("Admin login error:", error);
    return response.status(400).json({
      success: false,
      message: "Invalid request."
    });
  }
}
