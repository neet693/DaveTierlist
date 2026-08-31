import { createClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "./admin-login.js";


/*
=========================================================
ROBLOX AVATAR RATING
ADMIN AVATAR API
=========================================================

FRONTEND:
- Supabase Publishable Key
- Read-only public data

BACKEND:
- Supabase Secret Key
- Admin CRUD
- Storage upload/delete

SECURITY:
- Secret Key NEVER sent to browser
- Admin authentication handled by HttpOnly cookie
=========================================================
*/


/* ========================================================
   ENVIRONMENT
======================================================== */

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;


/* ========================================================
   DATABASE
======================================================== */

const TABLE = "avatars";
const BUCKET = "avatars";


/* ========================================================
   LIMITS
======================================================== */

const MAX_IMAGE_SIZE =
  10 * 1024 * 1024; // 10 MB


const ALLOWED_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};


/* ========================================================
   SUPABASE ADMIN CLIENT
======================================================== */

function getSupabaseAdmin() {
  if (
    !SUPABASE_URL
  ) {
    throw new Error(
      "SUPABASE_URL is not configured."
    );
  }

  if (
    !SUPABASE_SECRET_KEY
  ) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured."
    );
  }

  /*
   * IMPORTANT:
   *
   * This client exists ONLY on Vercel server.
   *
   * The secret key must NEVER be placed
   * in frontend JavaScript.
   */

  return createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}


/* ========================================================
   RESPONSE HELPERS
======================================================== */

function sendError(
  response,
  status,
  message
) {
  return response
    .status(status)
    .json({
      success: false,
      message
    });
}


function sendSuccess(
  response,
  data = {}
) {
  return response
    .status(200)
    .json({
      success: true,
      ...data
    });
}


/* ========================================================
   JSON BODY
======================================================== */

function parseJsonBody(request) {
  if (
    !request.body
  ) {
    return {};
  }

  if (
    typeof request.body ===
    "object"
  ) {
    return request.body;
  }

  try {
    return JSON.parse(
      request.body
    );
  } catch {
    throw new Error(
      "Invalid JSON request body."
    );
  }
}


/* ========================================================
   IMAGE DATA
======================================================== */

function parseImageData(
  imageData
) {
  if (!imageData) {
    return null;
  }

  if (
    typeof imageData !==
    "string"
  ) {
    throw new Error(
      "Invalid image data."
    );
  }

  /*
   * Supported:
   *
   * data:image/png;base64,...
   * data:image/jpeg;base64,...
   * data:image/webp;base64,...
   */

  const match =
    imageData.match(
      /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i
    );

  if (!match) {
    throw new Error(
      "Unsupported image format. Only PNG, JPG, and WebP are allowed."
    );
  }

  const contentType =
    match[1].toLowerCase();

  const base64 =
    match[2];

  const extension =
    ALLOWED_IMAGE_TYPES[
      contentType
    ];

  if (!extension) {
    throw new Error(
      "Unsupported image format."
    );
  }

  let buffer;

  try {
    buffer =
      Buffer.from(
        base64,
        "base64"
      );
  } catch {
    throw new Error(
      "Invalid base64 image data."
    );
  }

  if (
    !buffer ||
    buffer.length === 0
  ) {
    throw new Error(
      "Image data is empty."
    );
  }

  if (
    buffer.length >
    MAX_IMAGE_SIZE
  ) {
    throw new Error(
      "Image size must not exceed 10 MB."
    );
  }

  return {
    buffer,
    contentType,
    extension
  };
}


/* ========================================================
   STORAGE PATH
======================================================== */

function createStoragePath(
  avatarId,
  extension
) {
  return (
    `avatars/${avatarId}-${Date.now()}.${extension}`
  );
}


/* ========================================================
   PUBLIC STORAGE URL
======================================================== */

function createPublicStorageUrl(
  path
) {
  return (
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
  );
}


/* ========================================================
   EXTRACT STORAGE PATH
======================================================== */

function extractStoragePath(
  url
) {
  if (!url) {
    return null;
  }

  try {
    const marker =
      `/storage/v1/object/public/${BUCKET}/`;

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


/* ========================================================
   DELETE STORAGE FILE
======================================================== */

async function deleteStorageFile(
  supabase,
  imageUrl
) {
  if (!imageUrl) {
    return;
  }

  const path =
    extractStoragePath(
      imageUrl
    );

  if (!path) {
    return;
  }

  try {
    const {
      error
    } =
      await supabase
        .storage
        .from(BUCKET)
        .remove([
          path
        ]);

    if (error) {
      console.warn(
        "[Storage] Delete warning:",
        error
      );
    }

  } catch (error) {
    console.warn(
      "[Storage] Delete exception:",
      error
    );
  }
}


/* ========================================================
   SAVE AVATAR
======================================================== */

async function saveAvatar(
  supabase,
  body
) {
  const avatar =
    body.avatar;

  if (
    !avatar ||
    !avatar.id
  ) {
    throw new Error(
      "Avatar data is required."
    );
  }

  const avatarId =
    String(
      avatar.id
    ).trim();

  if (!avatarId) {
    throw new Error(
      "Avatar ID is required."
    );
  }


  /* ------------------------------------------------------
     GET EXISTING
  ------------------------------------------------------ */

  const {
    data: existingAvatar,
    error: existingError
  } =
    await supabase
      .from(TABLE)
      .select("*")
      .eq(
        "id",
        avatarId
      )
      .maybeSingle();

  if (existingError) {
    throw existingError;
  }


  /* ------------------------------------------------------
     CURRENT IMAGE
  ------------------------------------------------------ */

  let imageUrl =
    avatar.image_url ||
    existingAvatar?.image_url ||
    null;

  let uploadedNewImage =
    false;


  /* ------------------------------------------------------
     NEW IMAGE
  ------------------------------------------------------ */

  if (
    body.imageData
  ) {
    const image =
      parseImageData(
        body.imageData
      );

    const path =
      createStoragePath(
        avatarId,
        image.extension
      );

    console.log(
      "[Storage] Uploading:",
      path
    );

    const {
      error: uploadError
    } =
      await supabase
        .storage
        .from(BUCKET)
        .upload(
          path,
          image.buffer,
          {
            contentType:
              image.contentType,

            cacheControl:
              "31536000",

            upsert:
              false
          }
        );

    if (uploadError) {
      console.error(
        "[Storage] Upload error:",
        uploadError
      );

      throw new Error(
        uploadError.message ||
        "Failed to upload image."
      );
    }

    imageUrl =
      createPublicStorageUrl(
        path
      );

    uploadedNewImage =
      true;

    console.log(
      "[Storage] Upload successful."
    );
  }


  /* ------------------------------------------------------
     DATABASE OBJECT
  ------------------------------------------------------ */

  const databaseAvatar = {
    id:
      avatarId,

    username:
      String(
        avatar.username ?? ""
      ).trim(),

    display_name:
      String(
        avatar.display_name ?? ""
      ).trim(),

    outfit_code:
      String(
        avatar.outfit_code ?? ""
      ).trim(),

    profile_url:
      String(
        avatar.profile_url ?? ""
      ).trim(),

    image_url:
      imageUrl,

    score:
      Number.isFinite(
        Number(avatar.score)
      )
        ? Number(avatar.score)
        : 0,

    tier:
      String(
        avatar.tier || "D"
      )
        .trim()
        .toUpperCase(),

    comment:
      String(
        avatar.comment ?? ""
      ).trim(),

    rated_at:
      avatar.rated_at ||
      existingAvatar?.rated_at ||
      new Date().toISOString(),

    sort_order:
      Number.isFinite(
        Number(avatar.sort_order)
      )
        ? Number(
            avatar.sort_order
          )
        : 0,

    updated_at:
      new Date().toISOString()
  };


  /* ------------------------------------------------------
     DATABASE UPSERT
  ------------------------------------------------------ */

  console.log(
    "[Database] Saving avatar:",
    avatarId
  );

  const {
    data,
    error
  } =
    await supabase
      .from(TABLE)
      .upsert(
        databaseAvatar,
        {
          onConflict:
            "id"
        }
      )
      .select()
      .single();

  if (error) {
    /*
     * Database failed.
     *
     * Delete newly uploaded image
     * to prevent orphaned storage files.
     */

    if (
      uploadedNewImage &&
      imageUrl
    ) {
      await deleteStorageFile(
        supabase,
        imageUrl
      );
    }

    console.error(
      "[Database] Save error:",
      error
    );

    throw error;
  }


  /* ------------------------------------------------------
     DELETE OLD IMAGE
  ------------------------------------------------------ */

  if (
    uploadedNewImage &&
    existingAvatar?.image_url &&
    existingAvatar.image_url !==
      imageUrl
  ) {
    await deleteStorageFile(
      supabase,
      existingAvatar.image_url
    );
  }


  console.log(
    "[Database] Avatar saved:",
    avatarId
  );

  return data;
}


/* ========================================================
   DELETE AVATAR
======================================================== */

async function deleteAvatar(
  supabase,
  id
) {
  if (!id) {
    throw new Error(
      "Avatar ID is required."
    );
  }

  const avatarId =
    String(id).trim();


  /* ------------------------------------------------------
     FIND
  ------------------------------------------------------ */

  const {
    data: avatar,
    error: findError
  } =
    await supabase
      .from(TABLE)
      .select(
        "id,image_url"
      )
      .eq(
        "id",
        avatarId
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


  /* ------------------------------------------------------
     DELETE DATABASE
  ------------------------------------------------------ */

  const {
    error: deleteError
  } =
    await supabase
      .from(TABLE)
      .delete()
      .eq(
        "id",
        avatarId
      );

  if (deleteError) {
    throw deleteError;
  }


  /* ------------------------------------------------------
     DELETE IMAGE
  ------------------------------------------------------ */

  if (
    avatar.image_url
  ) {
    await deleteStorageFile(
      supabase,
      avatar.image_url
    );
  }


  return true;
}


/* ========================================================
   UPDATE ORDER
======================================================== */

async function updateOrder(
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
    avatars
      .filter(
        (avatar) =>
          avatar &&
          avatar.id
      )
      .map(
        (avatar) => ({
          id:
            String(
              avatar.id
            ),

          tier:
            String(
              avatar.tier || "D"
            )
              .trim()
              .toUpperCase(),

          sort_order:
            Number.isFinite(
              Number(
                avatar.sort_order
              )
            )
              ? Number(
                  avatar.sort_order
                )
              : 0,

          updated_at:
            new Date().toISOString()
        })
      );

  if (
    updates.length === 0
  ) {
    return [];
  }

  const {
    data,
    error
  } =
    await supabase
      .from(TABLE)
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


/* ========================================================
   IMPORT
======================================================== */

async function importAvatars(
  supabase,
  avatars
) {
  if (
    !Array.isArray(avatars) ||
    avatars.length === 0
  ) {
    throw new Error(
      "No avatars to import."
    );
  }

  const cleaned =
    avatars
      .filter(
        (avatar) =>
          avatar &&
          avatar.id
      )
      .map(
        (avatar) => ({
          id:
            String(
              avatar.id
            ),

          username:
            String(
              avatar.username || ""
            ).trim(),

          display_name:
            String(
              avatar.display_name || ""
            ).trim(),

          outfit_code:
            String(
              avatar.outfit_code || ""
            ).trim(),

          profile_url:
            String(
              avatar.profile_url || ""
            ).trim(),

          image_url:
            String(
              avatar.image_url || ""
            ).trim(),

          score:
            Number.isFinite(
              Number(
                avatar.score
              )
            )
              ? Number(
                  avatar.score
                )
              : 0,

          tier:
            String(
              avatar.tier || "D"
            )
              .trim()
              .toUpperCase(),

          comment:
            String(
              avatar.comment || ""
            ).trim(),

          rated_at:
            avatar.rated_at ||
            new Date().toISOString(),

          sort_order:
            Number.isFinite(
              Number(
                avatar.sort_order
              )
            )
              ? Number(
                  avatar.sort_order
                )
              : 0,

          updated_at:
            new Date().toISOString()
        })
      );

  if (
    cleaned.length === 0
  ) {
    throw new Error(
      "No valid avatars to import."
    );
  }

  const {
    data,
    error
  } =
    await supabase
      .from(TABLE)
      .upsert(
        cleaned,
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


/* ========================================================
   MAIN HANDLER
======================================================== */

export default async function handler(
  request,
  response
) {
  /*
   * ======================================================
   * AUTHENTICATION
   * ======================================================
   */

  if (
    !isAdminAuthenticated(
      request
    )
  ) {
    return sendError(
      response,
      401,
      "Unauthorized."
    );
  }


  /*
   * ======================================================
   * METHOD
   * ======================================================
   */

  if (
    !["GET", "POST"].includes(
      request.method
    )
  ) {
    response.setHeader(
      "Allow",
      "GET, POST"
    );

    return sendError(
      response,
      405,
      "Method not allowed."
    );
  }


  /*
   * ======================================================
   * SUPABASE
   * ======================================================
   */

  let supabase;

  try {
    supabase =
      getSupabaseAdmin();

  } catch (error) {
    console.error(
      "[Supabase] Initialization error:",
      error
    );

    return sendError(
      response,
      500,
      error.message
    );
  }


  /*
   * ======================================================
   * GET
   * ======================================================
   */

  if (
    request.method === "GET"
  ) {
    try {
      const {
        data,
        error
      } =
        await supabase
          .from(TABLE)
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

      return sendSuccess(
        response,
        {
          data:
            data || []
        }
      );

    } catch (error) {
      console.error(
        "[Admin Avatar] GET error:",
        error
      );

      return sendError(
        response,
        500,
        error.message ||
          "Failed to load avatars."
      );
    }
  }


  /*
   * ======================================================
   * POST
   * ======================================================
   */

  try {
    const body =
      parseJsonBody(
        request
      );

    const action =
      body.action;


    /* ----------------------------------------------------
       SAVE
    ---------------------------------------------------- */

    if (
      action === "save"
    ) {
      const avatar =
        await saveAvatar(
          supabase,
          body
        );

      return sendSuccess(
        response,
        {
          avatar
        }
      );
    }


    /* ----------------------------------------------------
       DELETE
    ---------------------------------------------------- */

    if (
      action === "delete"
    ) {
      await deleteAvatar(
        supabase,
        body.id
      );

      return sendSuccess(
        response
      );
    }


    /* ----------------------------------------------------
       REORDER
    ---------------------------------------------------- */

    if (
      action === "reorder" ||
      action === "update-order"
    ) {
      const data =
        await updateOrder(
          supabase,
          body.avatars
        );

      return sendSuccess(
        response,
        {
          data
        }
      );
    }


    /* ----------------------------------------------------
       IMPORT
    ---------------------------------------------------- */

    if (
      action === "import"
    ) {
      const data =
        await importAvatars(
          supabase,
          body.avatars
        );

      return sendSuccess(
        response,
        {
          data
        }
      );
    }


    /* ----------------------------------------------------
       UNKNOWN
    ---------------------------------------------------- */

    return sendError(
      response,
      400,
      "Unknown admin action."
    );

  } catch (error) {
    console.error(
      "[Admin Avatar API] Error:",
      error
    );

    return sendError(
      response,
      500,
      error?.message ||
        "Internal server error."
    );
  }
}
