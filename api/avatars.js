"use strict";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASEPUBLISHABLEKEY ||
  process.env.SUPABASE_ANON_KEY;

const TABLE_NAME = "avatars";
const BUCKET_NAME = "avatars";

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(data));
}

function getSupabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

function getAvatarImageUrl(path) {
  if (!path) return null;

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${path}`;
}

function mapAvatar(row) {
  return {
    id: row.id,
    username: row.username || "",
    displayName: row.display_name || "",
    outfitCode: row.outfit_code || "",
    profileUrl: row.profile_url || "",
    score: Number(row.score ?? 0),
    tier: row.tier || "S",
    comment: row.comment || "",
    image: getAvatarImageUrl(row.image_url),
    date: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isAdmin(req) {
  /*
   * Admin authentication tetap dilakukan oleh /api/admin-login.
   * Session browser tidak bisa dipercaya oleh server.
   *
   * Untuk tahap pertama kita gunakan header internal
   * yang nanti akan kita pasang dari script.js setelah login.
   */
  const token = req.headers["x-admin-session"];

  return Boolean(token);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      ...getSupabaseHeaders(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error_description ||
      data?.hint ||
      data?.error ||
      `Supabase request failed (${response.status})`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function uploadImage(base64, fileName, contentType) {
  if (!base64) return null;

  const match = base64.match(/^data:(.+);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid image data.");
  }

  const buffer = Buffer.from(match[2], "base64");

  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Image size cannot exceed 5 MB.");
  }

  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg";

  const safeName =
    String(fileName || "avatar")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 80) || "avatar";

  const path = `avatar-${Date.now()}-${safeName}.${extension}`;

  await supabaseRequest(
    `/storage/v1/object/${BUCKET_NAME}/${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": contentType || "image/jpeg",
        "x-upsert": "false"
      },
      body: buffer
    }
  );

  return path;
}

async function deleteImage(path) {
  if (!path) return;

  /*
   * Jika yang tersimpan ternyata URL penuh, ambil path
   * setelah nama bucket.
   */
  let storagePath = path;

  const marker = `/storage/v1/object/public/${BUCKET_NAME}/`;

  if (storagePath.includes(marker)) {
    storagePath = storagePath.split(marker)[1];
  }

  if (!storagePath) return;

  try {
    await supabaseRequest("/storage/v1/object/" + BUCKET_NAME, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prefixes: [decodeURIComponent(storagePath)]
      })
    });
  } catch (error) {
    console.warn("Failed to delete image:", error);
  }
}

async function getAllAvatars() {
  const rows = await supabaseRequest(
    `/rest/v1/${TABLE_NAME}?select=*&order=created_at.asc`
  );

  return Array.isArray(rows) ? rows.map(mapAvatar) : [];
}

async function createAvatar(body) {
  const {
    username,
    displayName,
    outfitCode,
    profileUrl,
    score,
    tier,
    comment,
    imageData,
    imageFileName,
    imageContentType
  } = body;

  if (!username) {
    throw new Error("Roblox Username wajib diisi.");
  }

  if (!outfitCode) {
    throw new Error("Outfit Code wajib diisi.");
  }

  if (!imageData) {
    throw new Error("Avatar Screenshot wajib diupload.");
  }

  const numericScore = Number(score ?? 0);

  if (
    Number.isNaN(numericScore) ||
    numericScore < 0 ||
    numericScore > 10
  ) {
    throw new Error("Rating harus antara 0 sampai 10.");
  }

  const validTier = ["S", "A", "B", "C", "D"].includes(tier)
    ? tier
    : "S";

  const imagePath = await uploadImage(
    imageData,
    imageFileName,
    imageContentType
  );

  try {
    const rows = await supabaseRequest(`/rest/v1/${TABLE_NAME}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        username: String(username).trim(),
        display_name: String(displayName || username).trim(),
        outfit_code: String(outfitCode).trim(),
        profile_url: String(profileUrl || "").trim(),
        score: numericScore,
        tier: validTier,
        comment: String(comment || "").trim(),
        image_url: imagePath
      })
    });

    return Array.isArray(rows) && rows[0]
      ? mapAvatar(rows[0])
      : null;
  } catch (error) {
    await deleteImage(imagePath);
    throw error;
  }
}

async function updateAvatar(id, body) {
  if (!id) {
    throw new Error("Avatar ID wajib diberikan.");
  }

  const currentRows = await supabaseRequest(
    `/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=*`
  );

  if (!Array.isArray(currentRows) || !currentRows[0]) {
    const error = new Error("Avatar tidak ditemukan.");
    error.status = 404;
    throw error;
  }

  const current = currentRows[0];

  const username =
    body.username !== undefined
      ? String(body.username).trim()
      : current.username;

  const displayName =
    body.displayName !== undefined
      ? String(body.displayName).trim()
      : current.display_name;

  const outfitCode =
    body.outfitCode !== undefined
      ? String(body.outfitCode).trim()
      : current.outfit_code;

  const profileUrl =
    body.profileUrl !== undefined
      ? String(body.profileUrl).trim()
      : current.profile_url;

  const numericScore =
    body.score !== undefined
      ? Number(body.score)
      : Number(current.score ?? 0);

  const tier =
    body.tier !== undefined
      ? body.tier
      : current.tier;

  const comment =
    body.comment !== undefined
      ? String(body.comment).trim()
      : current.comment;

  if (!username) {
    throw new Error("Roblox Username wajib diisi.");
  }

  if (!outfitCode) {
    throw new Error("Outfit Code wajib diisi.");
  }

  if (
    Number.isNaN(numericScore) ||
    numericScore < 0 ||
    numericScore > 10
  ) {
    throw new Error("Rating harus antara 0 sampai 10.");
  }

  if (!["S", "A", "B", "C", "D"].includes(tier)) {
    throw new Error("Tier tidak valid.");
  }

  let imagePath = current.image_url;

  if (body.imageData) {
    imagePath = await uploadImage(
      body.imageData,
      body.imageFileName,
      body.imageContentType
    );
  }

  try {
    const rows = await supabaseRequest(
      `/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          username,
          display_name: displayName,
          outfit_code: outfitCode,
          profile_url: profileUrl,
          score: numericScore,
          tier,
          comment,
          image_url: imagePath,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (body.imageData && current.image_url) {
      await deleteImage(current.image_url);
    }

    return Array.isArray(rows) && rows[0]
      ? mapAvatar(rows[0])
      : null;
  } catch (error) {
    if (body.imageData && imagePath && imagePath !== current.image_url) {
      await deleteImage(imagePath);
    }

    throw error;
  }
}

async function deleteAvatar(id) {
  if (!id) {
    throw new Error("Avatar ID wajib diberikan.");
  }

  const rows = await supabaseRequest(
    `/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}&select=*`
  );

  if (!Array.isArray(rows) || !rows[0]) {
    const error = new Error("Avatar tidak ditemukan.");
    error.status = 404;
    throw error;
  }

  const avatar = rows[0];

  await supabaseRequest(
    `/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`,
    {
      method: "DELETE"
    }
  );

  if (avatar.image_url) {
    await deleteImage(avatar.image_url);
  }

  return true;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return json(res, 500, {
      success: false,
      message: "Supabase environment variables belum dikonfigurasi di Vercel."
    });
  }

  try {
    if (req.method === "GET") {
      const data = await getAllAvatars();

      return json(res, 200, {
        success: true,
        data
      });
    }

    /*
     * Untuk sementara endpoint write hanya bisa dipanggil
     * dengan header x-admin-session.
     */
    if (!isAdmin(req)) {
      return json(res, 401, {
        success: false,
        message: "Unauthorized."
      });
    }

    if (req.method === "POST") {
      const body = await getBody(req);
      const avatar = await createAvatar(body);

      return json(res, 201, {
        success: true,
        data: avatar
      });
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      const body = await getBody(req);
      const id = body.id;

      const avatar = await updateAvatar(id, body);

      return json(res, 200, {
        success: true,
        data: avatar
      });
    }

    if (req.method === "DELETE") {
      const body = await getBody(req);

      await deleteAvatar(body.id);

      return json(res, 200, {
        success: true
      });
    }

    return json(res, 405, {
      success: false,
      message: "Method not allowed."
    });
  } catch (error) {
    console.error("Avatar API error:", error);

    return json(res, error.status || 500, {
      success: false,
      message: error.message || "Internal server error."
    });
  }
}
