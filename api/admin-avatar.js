import {
  createClient
} from "@supabase/supabase-js";

import {
  isAdminAuthenticated
} from "./admin-login.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY;

const TABLE =
  "avatars";

const BUCKET =
  "avatars";

function getSupabaseAdmin() {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SECRET_KEY
  ) {
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

export default async function handler(
  request,
  response
) {
  /*
   * =====================================================
   * AUTHENTICATION
   * =====================================================
   */

  if (
    !isAdminAuthenticated(request)
  ) {
    return sendError(
      response,
      401,
      "Unauthorized."
    );
  }

  /*
   * =====================================================
   * SUPABASE
   * =====================================================
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

  try {
    /*
     * ===================================================
     * GET
     * ===================================================
     */

    if (
      request.method === "GET"
    ) {
      const {
        data,
        error
      } = await supabase
        .from(TABLE)
        .select("*")
        .order(
          "sort_order",
          {
            ascending: true
          }
        );

      if (error) {
        console.error(
          "GET avatars error:",
          error
        );

        throw error;
      }

      return response
        .status(200)
        .json({
          success: true,
          data: data || []
        });
    }

    /*
     * ===================================================
     * POST
     * ===================================================
     */

    if (
      request.method === "POST"
    ) {
      const contentType =
        request.headers[
          "content-type"
        ] || "";

      /*
       * -----------------------------------------------
       * JSON REQUEST
       * -----------------------------------------------
       */

      if (
        contentType.includes(
          "application/json"
        )
      ) {
        const body =
          typeof request.body === "string"
            ? JSON.parse(
                request.body || "{}"
              )
            : request.body || {};

        const action =
          body.action;

        /*
         * ADD / EDIT / UPSERT
         */

        if (
          action === "save"
        ) {
          const avatar =
            body.avatar;

          if (
            !avatar ||
            !avatar.id
          ) {
            return sendError(
              response,
              400,
              "Avatar data is required."
            );
          }

          const {
            data,
            error
          } = await supabase
            .from(TABLE)
            .upsert(
              avatar,
              {
                onConflict: "id"
              }
            )
            .select()
            .single();

          if (error) {
            console.error(
              "Save avatar error:",
              error
            );

            throw error;
          }

          return response
            .status(200)
            .json({
              success: true,
              data
            });
        }

        /*
         * DELETE
         */

        if (
          action === "delete"
        ) {
          const id =
            body.id;

          if (!id) {
            return sendError(
              response,
              400,
              "Avatar ID is required."
            );
          }

          /*
           * Get image before deleting
           */

          const {
            data: avatar,
            error:
              avatarError
          } = await supabase
            .from(TABLE)
            .select(
              "image_url"
            )
            .eq(
              "id",
              id
            )
            .maybeSingle();

          if (avatarError) {
            throw avatarError;
          }

          /*
           * Delete database row
           */

          const {
            error
          } = await supabase
            .from(TABLE)
            .delete()
            .eq(
              "id",
              id
            );

          if (error) {
            console.error(
              "Delete avatar error:",
              error
            );

            throw error;
          }

          /*
           * Delete storage image
           */

          if (
            avatar?.image_url
          ) {
            const path =
              extractStoragePath(
                avatar.image_url
              );

            if (path) {
              const {
                error:
                  storageError
              } =
                await supabase
                  .storage
                  .from(BUCKET)
                  .remove([
                    path
                  ]);

              if (
                storageError
              ) {
                console.warn(
                  "Storage delete warning:",
                  storageError
                );
              }
            }
          }

          return response
            .status(200)
            .json({
              success: true
            });
        }

        /*
         * UPDATE SORT ORDERS
         */

        if (
          action ===
          "update-order"
        ) {
          const avatars =
            Array.isArray(
              body.avatars
            )
              ? body.avatars
              : [];

          if (
            !avatars.length
          ) {
            return response
              .status(200)
              .json({
                success: true
              });
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
                    avatar.sort_order ||
                    0
                  ),

                updated_at:
                  new Date()
                    .toISOString()
              })
            );

          const {
            error
          } = await supabase
            .from(TABLE)
            .upsert(
              updates,
              {
                onConflict:
                  "id"
              }
            );

          if (error) {
            console.error(
              "Update order error:",
              error
            );

            throw error;
          }

          return response
            .status(200)
            .json({
              success: true
            });
        }

        /*
         * IMPORT
         */

        if (
          action === "import"
        ) {
          const avatars =
            Array.isArray(
              body.avatars
            )
              ? body.avatars
              : [];

          if (
            !avatars.length
          ) {
            return sendError(
              response,
              400,
              "No avatars to import."
            );
          }

          const {
            data,
            error
          } = await supabase
            .from(TABLE)
            .upsert(
              avatars,
              {
                onConflict:
                  "id"
              }
            )
            .select();

          if (error) {
            throw error;
          }

          return response
            .status(200)
            .json({
              success: true,
              data:
                data || []
            });
        }
      }

      /*
       * -----------------------------------------------
       * MULTIPART / IMAGE UPLOAD
       * -----------------------------------------------
       *
       * Untuk upload file langsung dari browser,
       * API perlu menerima multipart.
       *
       * Jika script.js kamu mengirim base64,
       * gunakan action upload-base64.
       */

      if (
        contentType.includes(
          "application/json"
        )
      ) {
        return sendError(
          response,
          400,
          "Invalid admin request."
        );
      }

      return sendError(
        response,
        400,
        "Unsupported upload format."
      );
    }

    /*
     * ===================================================
     * DELETE
     * ===================================================
     */

    if (
      request.method === "DELETE"
    ) {
      const id =
        request.query?.id;

      if (!id) {
        return sendError(
          response,
          400,
          "Avatar ID is required."
        );
      }

      const {
        error
      } = await supabase
        .from(TABLE)
        .delete()
        .eq(
          "id",
          id
        );

      if (error) {
        throw error;
      }

      return response
        .status(200)
        .json({
          success: true
        });
    }

    response.setHeader(
      "Allow",
      "GET, POST, DELETE"
    );

    return sendError(
      response,
      405,
      "Method not allowed."
    );

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
          error?.message ||
          "Internal server error."
      });
  }
}


/* =========================================================
   STORAGE PATH
========================================================= */

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

    if (
      index === -1
    ) {
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
