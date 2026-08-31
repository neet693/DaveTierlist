// /api/admin-avatar.js
//
// Vercel Serverless Function
//
// POST /api/admin-avatar
//
// Actions:
//   save
//   delete
//   reorder
//   import
//
// Supabase Secret Key is NEVER exposed to browser.

import crypto from "crypto";
import {
  createClient
} from "@supabase/supabase-js";


/* =========================================================
   CONFIG
========================================================= */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;

const SESSION_COOKIE =
  "roblox_avatar_admin";

const SESSION_MAX_AGE =
  8 * 60 * 60;


/* =========================================================
   SUPABASE
========================================================= */

function getSupabaseAdmin() {
  if (!SUPABASE_URL) {
    throw new Error(
      "SUPABASE_URL is not configured."
    );
  }

  if (!SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured."
    );
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken:
          false,

        persistSession:
          false
      }
    }
  );
}


/* =========================================================
   COOKIE PARSER
========================================================= */

function getCookie(
  request,
  name
) {
  const cookieHeader =
    request.headers?.cookie ||
    "";

  const cookies =
    cookieHeader
      .split(";")
      .map(
        item =>
          item.trim()
      );

  for (
    const cookie of cookies
  ) {
    const index =
      cookie.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      cookie.substring(
        0,
        index
      );

    const value =
      cookie.substring(
        index + 1
      );

    if (
      key === name
    ) {
      return decodeURIComponent(
        value
      );
    }
  }

  return null;
}


/* =========================================================
   VERIFY SESSION
========================================================= */

function verifyAdminSession(
  request
) {
  const token =
    getCookie(
      request,
      SESSION_COOKIE
    );

  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (
    parts.length !== 3
  ) {
    return false;
  }

  const [
    issuedAtRaw,
    expiresAtRaw,
    signature
  ] = parts;

  const issuedAt =
    Number(
      issuedAtRaw
    );

  const expiresAt =
    Number(
      expiresAtRaw
    );

  if (
    !Number.isFinite(
      issuedAt
    ) ||
    !Number.isFinite(
      expiresAt
    ) ||
    !signature
  ) {
    return false;
  }

  const now =
    Math.floor(
      Date.now() / 1000
    );

  /*
   * Expired.
   */
  if (
    now >= expiresAt
  ) {
    return false;
  }

  /*
   * Prevent malformed/future sessions.
   */
  if (
    issuedAt > now + 60
  ) {
    return false;
  }

  /*
   * Prevent sessions older than
   * configured maximum.
   */
  if (
    now - issuedAt >
    SESSION_MAX_AGE
  ) {
    return false;
  }


  /*
   * Build signing secret.
   */

  const password =
    process.env.ADMIN_PASSWORD;

  if (!password) {
    return false;
  }

  const secret =
    crypto
      .createHash("sha256")
      .update(
        `roblox-avatar-admin:${password}`
      )
      .digest();


  /*
   * Recreate signature.
   */

  const payload =
    `${issuedAt}.${expiresAt}`;

  const expectedSignature =
    crypto
      .createHmac(
        "sha256",
        secret
      )
      .update(payload)
      .digest("base64url");


  /*
   * Constant-time comparison.
   */

  const a =
    Buffer.from(
      signature,
      "utf8"
    );

  const b =
    Buffer.from(
      expectedSignature,
      "utf8"
    );

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    a,
    b
  );
}


/* =========================================================
   CORS / SAME ORIGIN
========================================================= */

function validateOrigin(
  request
) {
  const origin =
    request.headers?.origin;

  /*
   * Some same-origin requests
   * may not contain Origin.
   */
  if (!origin) {
    return true;
  }

  const host =
    request.headers?.host;

  if (!host) {
    return true;
  }

  try {
    const originUrl =
      new URL(origin);

    return (
      originUrl.host ===
      host
    );
  } catch {
    return false;
  }
}


/* =========================================================
   STORAGE PATH
========================================================= */

function getStoragePathFromUrl(
  url
) {
  if (!url) {
    return null;
  }

  try {
    const marker =
      `/storage/v1/object/public/avatars/`;

    const index =
      url.indexOf(marker);

    if (index === -1) {
      return null;
    }

    return decodeURIComponent(
      url.substring(
        index +
          marker.length
      )
    );
  } catch {
    return null;
  }
}


/* =========================================================
   FILE EXTENSION
========================================================= */

function getFileExtension(
  filename
) {
  const clean =
    String(
      filename || ""
    )
      .split("?")[0]
      .split("#")[0];

  const parts =
    clean.split(".");

  if (
    parts.length < 2
  ) {
    return "jpg";
  }

  const extension =
    parts
      .pop()
      .toLowerCase();

  const allowed = [
    "jpg",
    "jpeg",
    "png",
    "webp"
  ];

  return allowed.includes(
    extension
  )
    ? extension
    : "jpg";
}


/* =========================================================
   SAFE STRING
========================================================= */

function stringValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim();
}


/* =========================================================
   SCORE
========================================================= */

function normalizeScore(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    )
  ) {
    return 0;
  }

  return Math.min(
    10,
    Math.max(
      0,
      number
    )
  );
}


/* =========================================================
   TIER
========================================================= */

function normalizeTier(
  value
) {
  const tier =
    String(
      value || "D"
    )
      .trim()
      .toUpperCase();

  return [
    "S",
    "A",
    "B",
    "C",
    "D"
  ].includes(tier)
    ? tier
    : "D";
}


/* =========================================================
   SAVE AVATAR
========================================================= */

async function saveAvatar(
  supabase,
  formData
) {
  const id =
    stringValue(
      formData.get("id")
    );

  const username =
    stringValue(
      formData.get(
        "username"
      )
    ).replace(/^@/, "");

  const displayName =
    stringValue(
      formData.get(
        "display_name"
      )
    );

  const outfitCode =
    stringValue(
      formData.get(
        "outfit_code"
      )
    );

  const profileUrl =
    stringValue(
      formData.get(
        "profile_url"
      )
    );

  const comment =
    stringValue(
      formData.get(
        "comment"
      )
    );

  const score =
    normalizeScore(
      formData.get("score")
    );

  const tier =
    normalizeTier(
      formData.get("tier")
    );

  const ratedAt =
    stringValue(
      formData.get(
        "rated_at"
      )
    ) ||
    new Date().toISOString();

  const suppliedSortOrder =
    Number(
      formData.get(
        "sort_order"
      )
    );

  const image =
    formData.get("image");


  if (!id) {
    throw new Error(
      "Avatar ID is required."
    );
  }

  if (!username) {
    throw new Error(
      "Username is required."
    );
  }

  if (!outfitCode) {
    throw new Error(
      "Outfit code is required."
    );
  }


  /*
   * -------------------------------------------------------
   * Find existing avatar
   * -------------------------------------------------------
   */

  const {
    data: existingAvatar,
    error: findError
  } =
    await supabase
      .from("avatars")
      .select(
        "id,image_url,sort_order,rated_at,created_at"
      )
      .eq(
        "id",
        id
      )
      .maybeSingle();

  if (findError) {
    throw findError;
  }


  let imageUrl =
    existingAvatar?.image_url ||
    "";

  let oldStoragePath =
    null;

  let newStoragePath =
    null;


  /*
   * -------------------------------------------------------
   * UPLOAD NEW IMAGE
   * -------------------------------------------------------
   */

  if (
    image &&
    typeof image ===
      "object" &&
    typeof image.arrayBuffer ===
      "function"
  ) {
    /*
     * Validate type.
     */

    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/webp"
    ];

    const contentType =
      image.type ||
      "application/octet-stream";

    if (
      !allowedTypes.includes(
        contentType
      )
    ) {
      throw new Error(
        "Only PNG, JPG, and WebP images are allowed."
      );
    }


    /*
     * Validate size.
     */

    const maxSize =
      10 * 1024 * 1024;

    if (
      image.size >
      maxSize
    ) {
      throw new Error(
        "Maximum image size is 10 MB."
      );
    }


    /*
     * Create storage path.
     */

    const extension =
      getFileExtension(
        image.name
      );

    newStoragePath =
      `${id}/avatar-${Date.now()}.${extension}`;


    /*
     * Convert File -> ArrayBuffer.
     */

    const arrayBuffer =
      await image.arrayBuffer();

    const buffer =
      Buffer.from(
        arrayBuffer
      );


    /*
     * Upload.
     */

    const {
      error: uploadError
    } =
      await supabase
        .storage
        .from("avatars")
        .upload(
          newStoragePath,
          buffer,
          {
            cacheControl:
              "3600",

            upsert:
              false,

            contentType
          }
        );

    if (uploadError) {
      throw uploadError;
    }


    /*
     * Get public URL.
     */

    const {
      data: publicUrlData
    } =
      supabase
        .storage
        .from("avatars")
        .getPublicUrl(
          newStoragePath
        );

    imageUrl =
      publicUrlData.publicUrl;


    /*
     * Old image gets deleted
     * only after DB succeeds.
     */

    if (
      existingAvatar?.image_url
    ) {
      oldStoragePath =
        getStoragePathFromUrl(
          existingAvatar.image_url
        );
    }
  }


  /*
   * -------------------------------------------------------
   * SORT ORDER
   * -------------------------------------------------------
   */

  let sortOrder =
    Number.isFinite(
      suppliedSortOrder
    )
      ? suppliedSortOrder
      : 0;


  /*
   * -------------------------------------------------------
   * PAYLOAD
   * -------------------------------------------------------
   */

  const payload = {
    id,

    username,

    display_name:
      displayName,

    outfit_code:
      outfitCode,

    profile_url:
      profileUrl ||
      `https://www.roblox.com/search/users?keyword=${encodeURIComponent(
        username
      )}`,

    image_url:
      imageUrl,

    score,

    tier,

    comment,

    rated_at:
      ratedAt,

    sort_order:
      sortOrder,

    updated_at:
      new Date().toISOString()
  };


  /*
   * Add created_at only
   * for new avatar.
   */

  if (
    !existingAvatar
  ) {
    payload.created_at =
      new Date().toISOString();
  }


  /*
   * -------------------------------------------------------
   * UPSERT
   * -------------------------------------------------------
   */

  const {
    data: savedAvatar,
    error: saveError
  } =
    await supabase
      .from("avatars")
      .upsert(
        payload,
        {
          onConflict:
            "id"
        }
      )
      .select()
      .single();

  if (saveError) {
    /*
     * DB failed.
     * Remove newly uploaded file
     * so it doesn't become orphaned.
     */

    if (
      newStoragePath
    ) {
      await supabase
        .storage
        .from("avatars")
        .remove([
          newStoragePath
        ])
        .catch(() => {});
    }

    throw saveError;
  }


  /*
   * -------------------------------------------------------
   * DELETE OLD IMAGE
   * -------------------------------------------------------
   */

  if (
    newStoragePath &&
    oldStoragePath &&
    oldStoragePath !==
      newStoragePath
  ) {
    const {
      error:
        deleteOldError
    } =
      await supabase
        .storage
        .from("avatars")
        .remove([
          oldStoragePath
        ]);

    if (deleteOldError) {
      console.warn(
        "Old image delete warning:",
        deleteOldError
      );
    }
  }


  return savedAvatar;
}


/* =========================================================
   DELETE AVATAR
========================================================= */

async function deleteAvatar(
  supabase,
  id
) {
  if (!id) {
    throw new Error(
      "Avatar ID is required."
    );
  }


  /*
   * Find image first.
   */

  const {
    data: avatar,
    error: findError
  } =
    await supabase
      .from("avatars")
      .select(
        "id,image_url"
      )
      .eq(
        "id",
        id
      )
      .maybeSingle();

  if (findError) {
    throw findError;
  }

  if (!avatar) {
    throw new Error(
      "Avatar not found."
    );
  }


  /*
   * Delete database record.
   */

  const {
    error: deleteError
  } =
    await supabase
      .from("avatars")
      .delete()
      .eq(
        "id",
        id
      );

  if (deleteError) {
    throw deleteError;
  }


  /*
   * Delete storage image.
   */

  const storagePath =
    getStoragePathFromUrl(
      avatar.image_url
    );

  if (storagePath) {
    const {
      error:
        storageError
    } =
      await supabase
        .storage
        .from("avatars")
        .remove([
          storagePath
        ]);

    if (storageError) {
      console.warn(
        "Storage delete warning:",
        storageError
      );
    }
  }


  return true;
}


/* =========================================================
   REORDER
========================================================= */

async function reorderAvatars(
  supabase,
  avatarList
) {
  if (
    !Array.isArray(
      avatarList
    )
  ) {
    throw new Error(
      "Invalid avatar order."
    );
  }

  if (
    avatarList.length >
    1000
  ) {
    throw new Error(
      "Too many avatars."
    );
  }


  const updates =
    avatarList.map(
      avatar => {
        const id =
          stringValue(
            avatar.id
          );

        if (!id) {
          throw new Error(
            "Invalid avatar ID in reorder request."
          );
        }

        return {
          id,

          tier:
            normalizeTier(
              avatar.tier
            ),

          sort_order:
            Math.max(
              0,
              Number(
                avatar.sort_order
              ) || 0
            ),

          updated_at:
            new Date().toISOString()
        };
      }
    );


  /*
   * Upsert updates.
   */

  const {
    data,
    error
  } =
    await supabase
      .from("avatars")
      .upsert(
        updates,
        {
          onConflict:
            "id"
        }
      )
      .select();

  if (error) {
    throw error;
  }

  return data || [];
}


/* =========================================================
   IMPORT
========================================================= */

async function importAvatars(
  supabase,
  avatarList
) {
  if (
    !Array.isArray(
      avatarList
    )
  ) {
    throw new Error(
      "Invalid avatar data."
    );
  }

  if (
    !avatarList.length
  ) {
    throw new Error(
      "No avatars to import."
    );
  }

  if (
    avatarList.length >
    1000
  ) {
    throw new Error(
      "Import is limited to 1000 avatars."
    );
  }


  const now =
    new Date().toISOString();


  const normalized =
    avatarList.map(
      (avatar, index) => {
        const id =
          stringValue(
            avatar.id
          );

        if (!id) {
          throw new Error(
            `Avatar #${
              index + 1
            } has no ID.`
          );
        }

        const username =
          stringValue(
            avatar.username
          ).replace(
            /^@/,
            ""
          );

        if (!username) {
          throw new Error(
            `Avatar #${
              index + 1
            } has no username.`
          );
        }

        return {
          id,

          username,

          display_name:
            stringValue(
              avatar.display_name
            ),

          outfit_code:
            stringValue(
              avatar.outfit_code
            ),

          profile_url:
            stringValue(
              avatar.profile_url
            ),

          image_url:
            stringValue(
              avatar.image_url
            ),

          score:
            normalizeScore(
              avatar.score
            ),

          tier:
            normalizeTier(
              avatar.tier
            ),

          comment:
            stringValue(
              avatar.comment
            ),

          rated_at:
            stringValue(
              avatar.rated_at
            ) ||
            now,

          sort_order:
            Math.max(
              0,
              Number(
                avatar.sort_order
              ) || 0
            ),

          updated_at:
            now
        };
      }
    );


  const {
    data,
    error
  } =
    await supabase
      .from("avatars")
      .upsert(
        normalized,
        {
          onConflict:
            "id"
        }
      )
      .select();

  if (error) {
    throw error;
  }

  return data || [];
}


/* =========================================================
   PARSE FORM DATA
========================================================= */

async function parseRequest(
  request
) {
  const contentType =
    request.headers?.[
      "content-type"
    ] ||
    "";

  if (
    contentType.includes(
      "multipart/form-data"
    )
  ) {
    return {
      type: "form",
      data:
        await request.formData()
    };
  }


  /*
   * JSON.
   */

  let body =
    request.body;

  if (
    typeof body ===
    "string"
  ) {
    try {
      body =
        JSON.parse(
          body
        );
    } catch {
      body = {};
    }
  }

  return {
    type: "json",
    data:
      body || {}
  };
}


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  request,
  response
) {
  /*
   * -------------------------------------------------------
   * METHOD
   * -------------------------------------------------------
   */

  if (
    request.method !==
    "POST"
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


  /*
   * -------------------------------------------------------
   * ORIGIN
   * -------------------------------------------------------
   */

  if (
    !validateOrigin(
      request
    )
  ) {
    return response
      .status(403)
      .json({
        success: false,
        message:
          "Invalid request origin."
      });
  }


  /*
   * -------------------------------------------------------
   * ADMIN AUTH
   * -------------------------------------------------------
   */

  if (
    !verifyAdminSession(
      request
    )
  ) {
    return response
      .status(401)
      .json({
        success: false,
        message:
          "Unauthorized. Please login as admin."
      });
  }


  try {
    /*
     * -----------------------------------------------------
     * SUPABASE ADMIN CLIENT
     * -----------------------------------------------------
     */

    const supabase =
      getSupabaseAdmin();


    /*
     * -----------------------------------------------------
     * PARSE REQUEST
     * -----------------------------------------------------
     */

    const parsed =
      await parseRequest(
        request
      );


    /*
     * -----------------------------------------------------
     * ACTION
     * -----------------------------------------------------
     */

    let action;

    if (
      parsed.type ===
      "form"
    ) {
      action =
        stringValue(
          parsed.data.get(
            "action"
          )
        );
    } else {
      action =
        stringValue(
          parsed.data.action
        );
    }


    /*
     * -----------------------------------------------------
     * SAVE
     * -----------------------------------------------------
     */

    if (
      action ===
      "save"
    ) {
      if (
        parsed.type !==
        "form"
      ) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "Save requires multipart form data."
          });
      }

      const avatar =
        await saveAvatar(
          supabase,
          parsed.data
        );

      return response
        .status(200)
        .json({
          success: true,
          avatar
        });
    }


    /*
     * -----------------------------------------------------
     * DELETE
     * -----------------------------------------------------
     */

    if (
      action ===
      "delete"
    ) {
      const id =
        parsed.type ===
        "json"
          ? stringValue(
              parsed.data.id
            )
          : stringValue(
              parsed.data.get(
                "id"
              )
            );

      await deleteAvatar(
        supabase,
        id
      );

      return response
        .status(200)
        .json({
          success: true
        });
    }


    /*
     * -----------------------------------------------------
     * REORDER
     * -----------------------------------------------------
     */

    if (
      action ===
      "reorder"
    ) {
      if (
        parsed.type !==
        "json"
      ) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "Reorder requires JSON."
          });
      }

      const data =
        await reorderAvatars(
          supabase,
          parsed.data.avatars
        );

      return response
        .status(200)
        .json({
          success: true,
          avatars: data
        });
    }


    /*
     * -----------------------------------------------------
     * IMPORT
     * -----------------------------------------------------
     */

    if (
      action ===
      "import"
    ) {
      if (
        parsed.type !==
        "json"
      ) {
        return response
          .status(400)
          .json({
            success: false,
            message:
              "Import requires JSON."
          });
      }

      const data =
        await importAvatars(
          supabase,
          parsed.data.avatars
        );

      return response
        .status(200)
        .json({
          success: true,
          avatars: data
        });
    }


    /*
     * -----------------------------------------------------
     * UNKNOWN ACTION
     * -----------------------------------------------------
     */

    return response
      .status(400)
      .json({
        success: false,
        message:
          "Unknown admin action."
      });
  } catch (error) {
    console.error(
      "Admin avatar API error:",
      error
    );

    return response
      .status(500)
      .json({
        success: false,
        message:
          error.message ||
          "Server error."
      });
  }
}
