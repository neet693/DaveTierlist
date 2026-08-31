# Roblox Avatar Tier List

Vanilla HTML + Tailwind CDN + JavaScript, ready for GitHub and Vercel.

## Important security change

The admin password is NOT inside `index.html` or `script.js`.

The login request is sent to:

`POST /api/admin-login`

The API reads:

`process.env.ADMIN_PASSWORD`

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set a strong `ADMIN_PASSWORD`.
3. Install Vercel CLI if needed.
4. Run `vercel dev`.

## Vercel

In Vercel:

Project → Settings → Environment Variables

Add:

`ADMIN_PASSWORD`

Set it for Production (and Preview/Development if desired).

Then deploy.

## GitHub

Upload all project files EXCEPT `.env.local`.

`.gitignore` already prevents local environment files from being committed.

## Data model limitation

This version keeps avatar data in browser `localStorage`, just like the original project.

That means:
- Admin changes persist in the browser that made them.
- Export/Import JSON is available for backups.
- Different devices/browsers do NOT automatically share the same avatar data.
- The admin password is protected server-side, but the avatar database is still client-side.

For a future multi-device production version, the data layer should be moved to a database/API.
