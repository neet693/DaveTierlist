import crypto from "node:crypto";

/*
=========================================================
ROBLOX AVATAR RATING
ADMIN LOGIN API
=========================================================

Authentication:
- Password stored in Vercel environment variable:
  ADMIN_PASSWORD

Session:
- Signed HMAC token
- HttpOnly
- Secure
- SameSite=Lax
- 8 hours

IMPORTANT:
This authentication is independent from Supabase Auth.
=========================================================
*/

const SESSION_COOKIE = "roblox_admin_session";
const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours


/* ========================================================
   COOKIE PARSER
======================================================== */

function parseCookies(request) {
  const header = request.headers?.cookie || "";

  const cookies = {};

  if (!header) {
    return cookies;
  }

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) {
      return;
    }

    const key = part
      .slice(0, index)
      .trim();

    const value = part
      .slice(index + 1)
      .trim();

    try {
      cookies[key] =
        decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}


/* ========================================================
   CREATE SESSION TOKEN
======================================================== */

function createSessionToken() {
  const secret =
    process.env.ADMIN_PASSWORD;

  if (!secret) {
    throw new Error(
      "ADMIN_PASSWORD is not configured."
    );
  }

  const timestamp =
    Math.floor(
      Date.now() / 1000
    );

  const nonce =
    crypto
      .randomBytes(32)
      .toString("hex");

  const payload =
    `${timestamp}.${nonce}`;

  const signature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("hex");

  return (
    `${payload}.${signature}`
  );
}


/* ========================================================
   VERIFY SESSION TOKEN
======================================================== */

function verifySessionToken(token) {
  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [
    timestamp,
    nonce,
    signature
  ] = parts;

  if (
    !timestamp ||
    !nonce ||
    !signature
  ) {
    return false;
  }

  const timestampNumber =
    Number(timestamp);

  if (
    !Number.isFinite(
      timestampNumber
    )
  ) {
    return false;
  }

  const now =
    Math.floor(
      Date.now() / 1000
    );

  /*
   * Expired
   */

  if (
    now - timestampNumber >
    SESSION_MAX_AGE
  ) {
    return false;
  }

  /*
   * Token from future
   */

  if (
    timestampNumber >
    now + 60
  ) {
    return false;
  }

  const secret =
    process.env.ADMIN_PASSWORD;

  if (!secret) {
    return false;
  }

  const payload =
    `${timestamp}.${nonce}`;

  const expected =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("hex");

  /*
   * Timing-safe comparison
   */

  try {
    const actualBuffer =
      Buffer.from(
        signature,
        "hex"
      );

    const expectedBuffer =
      Buffer.from(
        expected,
        "hex"
      );

    if (
      actualBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    );

  } catch {
    return false;
  }
}


/* ========================================================
   EXPORTED AUTH CHECK
======================================================== */

export function isAdminAuthenticated(
  request
) {
  const cookies =
    parseCookies(request);

  return verifySessionToken(
    cookies[SESSION_COOKIE]
  );
}


/* ========================================================
   MAIN HANDLER
======================================================== */

export default async function handler(
  request,
  response
) {
  /*
   * ------------------------------------------------------
   * METHOD
   * ------------------------------------------------------
   */

  if (
    request.method !== "POST"
  ) {
    response.setHeader(
      "Allow",
      "POST"
    );

    return response
      .status(405)
      .json({
        success: false,
        message:
          "Method not allowed."
      });
  }

  try {
    /*
     * ----------------------------------------------------
     * ENV
     * ----------------------------------------------------
     */

    const expected =
      process.env.ADMIN_PASSWORD;

    if (!expected) {
      console.error(
        "[Admin Login] ADMIN_PASSWORD missing."
      );

      return response
        .status(500)
        .json({
          success: false,
          message:
            "Admin authentication is not configured."
        });
    }

    /*
     * ----------------------------------------------------
     * BODY
     * ----------------------------------------------------
     */

    let body =
      request.body || {};

    if (
      typeof body === "string"
    ) {
      try {
        body =
          JSON.parse(
            body || "{}"
          );
      } catch {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "Invalid JSON request body."
          });
      }
    }

    /*
     * ----------------------------------------------------
     * PASSWORD
     * ----------------------------------------------------
     */

    const password =
      body.password;

    if (
      typeof password !==
        "string" ||
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

    /*
     * ----------------------------------------------------
     * CHECK PASSWORD
     * ----------------------------------------------------
     */

    if (
      password !== expected
    ) {
      return response
        .status(401)
        .json({
          success: false,
          message:
            "Incorrect password."
        });
    }

    /*
     * ----------------------------------------------------
     * CREATE SESSION
     * ----------------------------------------------------
     */

    const token =
      createSessionToken();

    /*
     * ----------------------------------------------------
     * COOKIE
     * ----------------------------------------------------
     */

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

    console.log(
      "[Admin Login] Successful."
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
      "[Admin Login] Error:",
      error
    );

    return response
      .status(500)
      .json({
        success: false,
        message:
          "Internal server error."
      });
  }
}
