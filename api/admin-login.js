// /api/admin-login.js
// Vercel Serverless Function
//
// POST  /api/admin-login
// DELETE /api/admin-login
//
// POST:
//   Validate ADMIN_PASSWORD
//   Create HttpOnly admin session cookie
//
// DELETE:
//   Clear admin session cookie

import crypto from "crypto";


/* =========================================================
   CONFIG
========================================================= */

const SESSION_COOKIE =
  "roblox_avatar_admin";

const SESSION_MAX_AGE =
  8 * 60 * 60; // 8 hours


/* =========================================================
   TOKEN
========================================================= */

function getSessionSecret() {
  const secret =
    process.env.ADMIN_PASSWORD;

  if (!secret) {
    throw new Error(
      "ADMIN_PASSWORD is not configured."
    );
  }

  /*
   * We derive a separate signing secret
   * from ADMIN_PASSWORD.
   */
  return crypto
    .createHash("sha256")
    .update(
      `roblox-avatar-admin:${secret}`
    )
    .digest();
}


function createSessionToken() {
  const secret =
    getSessionSecret();

  const issuedAt =
    Math.floor(
      Date.now() / 1000
    );

  const expiresAt =
    issuedAt +
    SESSION_MAX_AGE;

  const payload =
    `${issuedAt}.${expiresAt}`;

  const signature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("base64url");

  return `${payload}.${signature}`;
}


/* =========================================================
   COOKIE
========================================================= */

function buildSessionCookie(
  token
) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}


function buildClearCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}


/* =========================================================
   PASSWORD COMPARISON
========================================================= */

function safeCompare(
  input,
  expected
) {
  const inputBuffer =
    Buffer.from(
      String(input),
      "utf8"
    );

  const expectedBuffer =
    Buffer.from(
      String(expected),
      "utf8"
    );

  if (
    inputBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    inputBuffer,
    expectedBuffer
  );
}


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  request,
  response
) {
  /*
   * -------------------------------------------------------
   * LOGOUT
   * -------------------------------------------------------
   */

  if (
    request.method ===
    "DELETE"
  ) {
    response.setHeader(
      "Set-Cookie",
      buildClearCookie()
    );

    return response
      .status(200)
      .json({
        success: true
      });
  }


  /*
   * -------------------------------------------------------
   * ONLY POST FOR LOGIN
   * -------------------------------------------------------
   */

  if (
    request.method !==
    "POST"
  ) {
    response.setHeader(
      "Allow",
      "POST, DELETE"
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
     * -----------------------------------------------------
     * ENV
     * -----------------------------------------------------
     */

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


    /*
     * -----------------------------------------------------
     * BODY
     * -----------------------------------------------------
     */

    const body =
      typeof request.body ===
      "string"
        ? JSON.parse(
            request.body ||
              "{}"
          )
        : request.body ||
          {};

    const password =
      body.password;


    /*
     * -----------------------------------------------------
     * VALIDATION
     * -----------------------------------------------------
     */

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
     * -----------------------------------------------------
     * PASSWORD CHECK
     * -----------------------------------------------------
     */

    if (
      !safeCompare(
        password,
        expected
      )
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
     * -----------------------------------------------------
     * CREATE SESSION
     * -----------------------------------------------------
     */

    const token =
      createSessionToken();

    response.setHeader(
      "Set-Cookie",
      buildSessionCookie(
        token
      )
    );


    /*
     * -----------------------------------------------------
     * SUCCESS
     * -----------------------------------------------------
     */

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
