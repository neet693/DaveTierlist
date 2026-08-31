import { createClient } from "@supabase/supabase-js";
import { isAdminAuthenticated } from "./admin-login.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const TABLE = "avatars";
const BUCKET = "avatars";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};


/* =========================================================
   SUPABASE ADMIN
========================================================= */

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Supabase server environment variables are not configured."
    );
  }

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


/* =========================================================
   RESPONSE HELPERS
========================================================= */

function sendError(response, status, message) {
  return response
    .status(status)
    .json({
      success: false,
      message
    });
}


function sendSuccess(response, data = {}) {
  return response
    .status(200)
    .json({
      success: true,
      ...data
    });
}


/* =========================================================
   BODY PARSER
========================================================= */

function parseJsonBody(request) {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === "object") {
    return request.body;
  }

  try {
    return JSON.parse(request.body);
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}


/* =========================================================
   IMAGE DATA
========================================================= */

function parseImageData(imageData) {
  if (!imageData) {
    return null;
  }

  if (typeof imageData !== "string") {
    throw new Error("Invalid image data.");
  }

  /*
   * Expected:
   *
   * data:image/png;base64,AAAA...
   *
   * OR
   *
   * data:image/jpeg;base64,AAAA...
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

  if (!buffer.length) {
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


/* =========================================================
   STORAGE PATH
========================================================= */

function createStoragePath(
  avatarId,
  extension
) {
  return `avatars/${avatarId}-${Date.now()}.${extension}`;
}


/* =========================================================
   PUBLIC STORAGE URL
========================================================= */

function createPublicStorageUrl(
  path
) {
  return (
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
  );
}


/* =========================================================
   EXTRACT STORAGE PATH
========================================================= */

function extractStoragePath(url) {
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


/* =========================================================
   DELETE STORAGE FILE
========================================================= */

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
        "Storage delete warning:",
        error
      );
    }
  } catch (error) {
    console.warn(
      "Storage delete exception:",
      error
    );
  }
}


/* =========================================================
   SAVE AVATAR
========================================================= */

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
    );

  /*
   * Get existing avatar.
   */

  const {
    data: existingAvatar,
    error: existingError
  } =
    await supabase
      .from(TABLE)
      .select("*")
      .eq("id", avatarId)
      .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  let imageUrl =
    avatar.image_url ||
    existingAvatar?.image_url ||
    null;

  /*
   * Upload new image
   */

  if (body.imageData) {
    const image =
      parseImageData(
        body.imageData
      );

    const path =
      createStoragePath(
        avatarId,
        image.extension
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
        "Storage upload error:",
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

    /*
     * Delete old image AFTER
     * new image uploaded successfully.
     */

    if (
      existingAvatar?.image_url &&
      existingAvatar.image_url !== imageUrl
    ) {
      await deleteStorageFile(
        supabase,
        existingAvatar.image_url
      );
    }
  }

  /*
   * Prepare database data.
   */

  const databaseAvatar = {
    id: avatarId,

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
      imageUrl,

    score:
      Number(
        avatar.score || 0
      ),

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
      existingAvatar?.rated_at ||
      new Date().toISOString(),

    sort_order:
      Number(
        avatar.sort_order || 0
      ),

    updated_at:
      new Date().toISOString()
  };

  /*
   * Insert / Update
   */

  const {
    data,
    error
  } =
    await supabase
      .from(TABLE)
      .upsert(
        databaseAvatar,
        {
          onConflict: "id"
        }
      )
      .select()
      .single();

  if (error) {
    /*
     * If DB save fails after image upload,
     * remove newly uploaded image so
     * we don't leave an orphan file.
     */

    if (
      body.imageData &&
      imageUrl
    ) {
      await deleteStorageFile(
        supabase,
        imageUrl
      );
    }

    console.error(
      "Save avatar database error:",
      error
    );

    throw error;
  }

  return data;
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
   * Find avatar first.
   */

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
   * Delete DB row.
   */

  const {
    error: deleteError
  } =
    await supabase
      .from(TABLE)
      .delete()
      .eq(
        "id",
        id
      );

  if (deleteError) {
    throw deleteError;
  }

  /*
   * Delete image.
   */

  if (avatar.image_url) {
    await deleteStorageFile(
      supabase,
      avatar.image_url
    );
  }

  return true;
}


/* =========================================================
   UPDATE ORDER
========================================================= */

async function updateOrder(
  supabase,
  avatars
) {
  if (
    !Array.isArray(avatars) ||
    !avatars.length
  ) {
    return;
  }

  const updates =
    avatars
      .filter(
        avatar =>
          avatar &&
          avatar.id
      )
      .map(
        avatar => ({
          id:
            avatar.id,

          tier:
            String(
              avatar.tier || "D"
            )
              .trim()
              .toUpperCase(),

          sort_order:
            Number(
              avatar.sort_order || 0
            ),

          updated_at:
            new Date()
              .toISOString()
        })
      );

  if (!updates.length) {
    return;
  }

  const {
    error
  } =
    await supabase
      .from(TABLE)
      .upsert(
        updates,
        {
          onConflict: "id"
        }
      );

  if (error) {
    throw error;
  }
}


/* =========================================================
   IMPORT
========================================================= */

async function importAvatars(
  supabase,
  avatars
) {
  if (
    !Array.isArray(avatars) ||
    !avatars.length
  ) {
    throw new Error(
      "No avatars to import."
    );
  }

  const cleaned =
    avatars
      .filter(
        avatar =>
          avatar &&
          avatar.id
      )
      .map(
        avatar => ({
          id:
            avatar.id,

          username:
            avatar.username ||
            "",

          display_name:
            avatar.display_name ||
            "",

          outfit_code:
            avatar.outfit_code ||
            "",

          profile_url:
            avatar.profile_url ||
            "",

          image_url:
            avatar.image_url ||
            "",

          score:
            Number(
              avatar.score || 0
            ),

          tier:
            String(
              avatar.tier || "D"
            )
              .trim()
              .toUpperCase(),

          comment:
            avatar.comment ||
            "",

          rated_at:
            avatar.rated_at ||
            new Date()
              .toISOString(),

          sort_order:
            Number(
              avatar.sort_order || 0
            )
        })
      );

  if (!cleaned.length) {
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
          onConflict: "id"
        }
      )
      .select();

  if (error) {
    throw error;
  }

  return data || [];
}


/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  request,
  response
) {
  /*
   * =======================================================
   * AUTH
   * =======================================================
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
   * =======================================================
   * METHOD
   * =======================================================
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
   * =======================================================
   * SUPABASE
   * =======================================================
   */

  let supabase;

  try {
    supabase =
      getSupabaseAdmin();
  } catch (error) {
    console.error(
      "Supabase initialization error:",
      error
    );

    return sendError(
      response,
      500,
      error.message
    );
  }

  /*
   * =======================================================
   * GET
   * =======================================================
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
        "GET avatars error:",
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
   * =======================================================
   * POST
   * =======================================================
   */

  try {
    const body =
      parseJsonBody(
        request
      );

    const action =
      body.action;

    /*
     * -----------------------------------------------------
     * SAVE
     * -----------------------------------------------------
     */

    if (
      action === "save"
    ) {
      /*
       * Frontend sends:
       *
       * {
       *   action: "save",
       *   avatar: {...},
       *   imageData: "data:image/png;base64,..."
       * }
       */

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

    /*
     * -----------------------------------------------------
     * DELETE
     * -----------------------------------------------------
     */

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

    /*
     * -----------------------------------------------------
     * REORDER
     *
     * Accept BOTH:
     *
     * action: "reorder"
     *
     * and old:
     *
     * action: "update-order"
     * -----------------------------------------------------
     */

    if (
      action === "reorder" ||
      action === "update-order"
    ) {
      await updateOrder(
        supabase,
        body.avatars
      );

      return sendSuccess(
        response
      );
    }

    /*
     * -----------------------------------------------------
     * IMPORT
     * -----------------------------------------------------
     */

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

    return sendError(
      response,
      400,
      "Unknown admin action."
    );

  } catch (error) {
    console.error(
      "Admin avatar API error:",
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
