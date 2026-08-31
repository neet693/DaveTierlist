import crypto from "node:crypto";

const SESSION_COOKIE = "roblox_admin_session";
const SESSION_MAX_AGE = 8 * 60 * 60; // 8 jam

function parseCookies(request) {
  const header = request.headers.cookie || "";
  const cookies = {};

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function createSessionToken() {
  const secret =
    process.env.ADMIN_PASSWORD;

  const timestamp =
    Math.floor(Date.now() / 1000);

  const nonce =
    crypto.randomBytes(32).toString("hex");

  const payload =
    `${timestamp}.${nonce}`;

  const signature =
    crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token) return false;

  const parts = token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [
    timestamp,
    nonce,
    signature
  ] = parts;

  const timestampNumber =
    Number(timestamp);

  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  const now =
    Math.floor(Date.now() / 1000);

  if (
    now - timestampNumber >
    SESSION_MAX_AGE
  ) {
    return false;
  }

  if (timestampNumber > now + 60) {
    return false;
  }

  const secret =
    process.env.ADMIN_PASSWORD;

  const payload =
    `${timestamp}.${nonce}`;

  const expected =
    crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

export function isAdminAuthenticated(request) {
  const cookies =
    parseCookies(request);

  return verifySessionToken(
    cookies[SESSION_COOKIE]
  );
}

export default async function handler(
  request,
  response
) {
  if (request.method !== "POST") {
    response.setHeader(
      "Allow",
      "POST"
    );

    return response
      .status(405)
      .json({
        success: false,
        message: "Method not allowed."
      });
  }

  try {
    const body =
      typeof request.body === "string"
        ? JSON.parse(
            request.body || "{}"
          )
        : request.body || {};

    const password =
      body.password;

    const expected =
      process.env.ADMIN_PASSWORD;

    if (!expected) {
      console.error(
        "ADMIN_PASSWORD is not configured."
      );

      return response
        .status(500)
        .json({
          success: false,
          message:
            "Admin authentication is not configured."
        });
    }

    if (
      typeof password !== "string" ||
      password.length === 0
    ) {
      return response
        .status(400)
        .json({
          success: false,
          message:
            "Password is required."
        });
    }

    if (password !== expected) {
      return response
        .status(401)
        .json({
          success: false,
          message:
            "Incorrect password."
        });
    }

    const token =
      createSessionToken();

    response.setHeader(
      "Set-Cookie",
      [
        `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${SESSION_MAX_AGE}`,
        "HttpOnly",
        "Secure",
        "SameSite=Lax"
      ].join("; ")
    );

    return response
      .status(200)
      .json({
        success: true,
        message:
          "Admin authentication successful."
      });

  } catch (error) {
    console.error(
      "Admin login error:",
      error
    );

    return response
      .status(400)
      .json({
        success: false,
        message:
          "Invalid request."
      });
  }
}
