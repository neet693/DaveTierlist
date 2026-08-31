// api/admin-avatar.js

import { createClient } from "@supabase/supabase-js";


// =========================================================
// ENVIRONMENT
// =========================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

const SUPABASE_BUCKET =
  "avatars";

const SUPABASE_TABLE =
  "avatars";


// =========================================================
// SUPABASE ADMIN CLIENT
// =========================================================

function createAdminClient() {
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
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
}


// =========================================================
// RESPONSE
// =========================================================

function sendError(
  res,
  status,
  message,
  extra = {}
) {
  return res.status(status).json({
    success: false,
    message,
    ...extra
  });
}


// =========================================================
// AUTHENTICATION
// =========================================================

function isAuthorized(req) {
  if (!ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_PASSWORD is not configured."
    );
  }

  const receivedPassword =
    req.headers["x-admin-password"];

  if (
    typeof receivedPassword !== "string" ||
    receivedPassword.length === 0
  ) {
    return false;
  }

  return (
    receivedPassword ===
    ADMIN_PASSWORD
  );
}


// =========================================================
// BODY PARSER
// =========================================================

function parseBody(req) {
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  return body || {};
}


// =========================================================
// STORAGE PATH
// =========================================================

function getStoragePathFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const marker =
      `/storage/v1/object/public/${SUPABASE_BUCKET}/`;

    const index =
      url.indexOf(marker);

    if (index === -1) {
      return null;
    }

    return decodeURIComponent(
      url.substring(
        index + marker.length
      )
    );

  } catch {
    return null;
  }
}


// =========================================================
// STORAGE UPLOAD
// =========================================================

async function uploadImage(
  supabase,
  file
) {
  if (!file) {
    throw new Error(
      "Image file is required."
    );
  }

  const {
    path,
    base64,
    contentType
  } = file;

  if (!path) {
    throw new Error(
      "Storage path is required."
    );
  }

  if (!base64) {
    throw new Error(
      "Image data is required."
    );
  }

  const cleanBase64 =
    base64.includes(",")
      ? base64.split(",")[1]
      : base64;

  const buffer =
    Buffer.from(
      cleanBase64,
      "base64"
    );

  const {
    error
  } =
    await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .upload(
        path,
        buffer,
        {
          contentType:
            contentType ||
            "image/jpeg",

          cacheControl:
            "3600",

          upsert:
            true
        }
      );

  if (error) {
    throw error;
  }

  const {
    data
  } =
    supabase
      .storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(path);

  return {
    path,
    url:
      data.publicUrl
  };
}


// =========================================================
// STORAGE DELETE
// =========================================================

async function deleteImage(
  supabase,
  path
) {
  if (!path) {
    return;
  }

  const {
    error
  } =
    await supabase
      .storage
      .from(SUPABASE_BUCKET)
      .remove([
        path
      ]);

  if (error) {
    console.warn(
      "Storage delete warning:",
      error
    );
  }
}


// =========================================================
// ENSURE BUCKET
// =========================================================

async function ensureBucket(
  supabase
) {
  const {
    data,
    error
  } =
    await supabase
      .storage
      .getBucket(
        SUPABASE_BUCKET
      );

  if (!error && data) {
    return;
  }

  const {
    error:
      createError
  } =
    await supabase
      .storage
      .createBucket(
        SUPABASE_BUCKET,
        {
          public: true,
          fileSizeLimit:
            "10MB",
          allowedMimeTypes: [
            "image/png",
            "image/jpeg",
            "image/webp"
          ]
        }
      );

  if (
    createError &&
    !String(
      createError.message || ""
    ).toLowerCase()
      .includes("already exists")
  ) {
    throw createError;
  }
}


// =========================================================
// GET AVATARS
// =========================================================

async function getAvatars(
  supabase
) {
  const {
    data,
    error
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
      .select("*")
      .order(
        "sort_order",
        {
          ascending: true
        }
      );

  if (error) {
    throw error;
  }

  return data || [];
}


// =========================================================
// CREATE AVATAR
// =========================================================

async function createAvatar(
  supabase,
  avatar
) {
  const {
    data,
    error
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
      .insert(
        avatar
      )
      .select()
      .single();

  if (error) {
    throw error;
  }

  return data;
}


// =========================================================
// UPDATE AVATAR
// =========================================================

async function updateAvatar(
  supabase,
  id,
  avatar
) {
  const {
    data,
    error
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
      .update(
        avatar
      )
      .eq(
        "id",
        id
      )
      .select()
      .single();

  if (error) {
    throw error;
  }

  return data;
}


// =========================================================
// DELETE AVATAR
// =========================================================

async function deleteAvatarRecord(
  supabase,
  id
) {
  const {
    data: existing,
    error:
      findError
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
      .select(
        "id,image_url"
      )
      .eq(
        "id",
        id
      )
      .single();

  if (findError) {
    throw findError;
  }

  const {
    error
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
      .delete()
      .eq(
        "id",
        id
      );

  if (error) {
    throw error;
  }

  if (
    existing?.image_url
  ) {
    const path =
      getStoragePathFromUrl(
        existing.image_url
      );

    if (path) {
      await deleteImage(
        supabase,
        path
      );
    }
  }

  return true;
}


// =========================================================
// UPSERT SORT ORDERS
// =========================================================

async function updateSortOrders(
  supabase,
  avatars
) {
  if (
    !Array.isArray(avatars) ||
    avatars.length === 0
  ) {
    return [];
  }

  const updates =
    avatars.map(
      (avatar) => ({
        id:
          avatar.id,

        tier:
          avatar.tier,

        sort_order:
          Number(
            avatar.sort_order || 0
          ),

        updated_at:
          new Date()
            .toISOString()
      })
    );

  const {
    data,
    error
  } =
    await supabase
      .from(
        SUPABASE_TABLE
      )
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


// =========================================================
// MAIN HANDLER
// =========================================================

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
  );

  // =======================================================
  // METHOD
  // =======================================================

  if (
    ![
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE"
    ].includes(req.method)
  ) {
    res.setHeader(
      "Allow",
      "GET, POST, PUT, PATCH, DELETE"
    );

    return sendError(
      res,
      405,
      "Method not allowed."
    );
  }

  // =======================================================
  // AUTH
  // =======================================================

  try {
    if (
      !isAuthorized(req)
    ) {
      return sendError(
        res,
        401,
        "Unauthorized."
      );
    }
  } catch (error) {
    console.error(
      "Auth configuration error:",
      error
    );

    return sendError(
      res,
      500,
      error.message
    );
  }

  // =======================================================
  // SUPABASE
  // =======================================================

  let supabase;

  try {
    supabase =
      createAdminClient();

    /*
     * Bucket should already exist.
     *
     * We do not automatically create it on every
     * request because the bucket should preferably
     * be created manually in Supabase Dashboard.
     */
  } catch (error) {
    console.error(
      "Supabase configuration error:",
      error
    );

    return sendError(
      res,
      500,
      error.message
    );
  }

  // =======================================================
  // REQUEST BODY
  // =======================================================

  const body =
    parseBody(req);

  try {

    // =====================================================
    // GET
    // =====================================================

    if (
      req.method === "GET"
    ) {
      const avatars =
        await getAvatars(
          supabase
        );

      return res.status(200).json({
        success: true,
        avatars
      });
    }


    // =====================================================
    // DELETE
    // =====================================================

    if (
      req.method === "DELETE"
    ) {
      const id =
        body.id ||
        req.query?.id;

      if (!id) {
        return sendError(
          res,
          400,
          "Avatar ID is required."
        );
      }

      await deleteAvatarRecord(
        supabase,
        id
      );

      return res.status(200).json({
        success: true,
        message:
          "Avatar deleted successfully."
      });
    }


    // =====================================================
    // SORT / DRAG DROP
    // =====================================================

    if (
      body.action ===
      "sort"
    ) {
      const updated =
        await updateSortOrders(
          supabase,
          body.avatars
        );

      return res.status(200).json({
        success: true,
        avatars:
          updated
      });
    }


    // =====================================================
    // UPLOAD
    // =====================================================

    if (
      body.action ===
      "upload"
    ) {
      const avatarId =
        body.avatarId;

      if (!avatarId) {
        return sendError(
          res,
          400,
          "avatarId is required."
        );
      }

      const uploaded =
        await uploadImage(
          supabase,
          body.file
        );

      return res.status(200).json({
        success: true,
        path:
          uploaded.path,
        url:
          uploaded.url
      });
    }


    // =====================================================
    // DELETE STORAGE
    // =====================================================

    if (
      body.action ===
      "delete-storage"
    ) {
      let path =
        body.path;

      if (
        !path &&
        body.url
      ) {
        path =
          getStoragePathFromUrl(
            body.url
          );
      }

      if (path) {
        await deleteImage(
          supabase,
          path
        );
      }

      return res.status(200).json({
        success: true
      });
    }


    // =====================================================
    // CREATE
    // =====================================================

    if (
      body.action ===
      "create"
    ) {
      const avatar =
        body.avatar;

      if (!avatar) {
        return sendError(
          res,
          400,
          "Avatar data is required."
        );
      }

      const data =
        await createAvatar(
          supabase,
          avatar
        );

      return res.status(200).json({
        success: true,
        avatar:
          data
      });
    }


    // =====================================================
    // UPDATE
    // =====================================================

    if (
      body.action ===
      "update"
    ) {
      const id =
        body.id;

      const avatar =
        body.avatar;

      if (!id) {
        return sendError(
          res,
          400,
          "Avatar ID is required."
        );
      }

      if (!avatar) {
        return sendError(
          res,
          400,
          "Avatar data is required."
        );
      }

      const data =
        await updateAvatar(
          supabase,
          id,
          avatar
        );

      return res.status(200).json({
        success: true,
        avatar:
          data
      });
    }


    // =====================================================
    // UPSERT
    // =====================================================

    if (
      body.action ===
      "upsert"
    ) {
      const avatar =
        body.avatar;

      if (!avatar) {
        return sendError(
          res,
          400,
          "Avatar data is required."
        );
      }

      const {
        data,
        error
      } =
        await supabase
          .from(
            SUPABASE_TABLE
          )
          .upsert(
            avatar,
            {
              onConflict:
                "id"
            }
          )
          .select()
          .single();

      if (error) {
        throw error;
      }

      return res.status(200).json({
        success: true,
        avatar:
          data
      });
    }


    // =====================================================
    // UNKNOWN ACTION
    // =====================================================

    return sendError(
      res,
      400,
      "Unknown admin action."
    );

  } catch (error) {

    // =====================================================
    // IMPORTANT SERVER LOG
    // =====================================================

    console.error(
      "ADMIN AVATAR API ERROR:",
      {
        message:
          error?.message,

        code:
          error?.code,

        details:
          error?.details,

        hint:
          error?.hint,

        name:
          error?.name
      }
    );

    return res.status(500).json({
      success: false,

      message:
        error?.message ||
        "Internal server error.",

      code:
        error?.code ||
        null,

      details:
        error?.details ||
        null,

      hint:
        error?.hint ||
        null
    });
  }
}
