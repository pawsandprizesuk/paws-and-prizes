
const COOKIE_NAME = "pp_admin_session";
const SESSION_DURATION = 8 * 60 * 60;

const COMPETITION_FIELDS = [
  "title",
  "theme",
  "description",
  "prize",
  "prize_value",
  "ticket_quantity",
  "ticket_price",
  "start_date",
  "closing_date",
  "status",
  "tickets_sold",
  "image_url",
  "gallery_images",
  "rules",
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded =
    normalized + "=".repeat((4 - (normalized.length % 4)) % 4);

  return Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0)
  );
}

async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSession(secret) {
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        admin: true,
        expires: Math.floor(Date.now() / 1000) + SESSION_DURATION,
        nonce: crypto.randomUUID(),
      })
    )
  );

  const key = await getSigningKey(secret);

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

async function validSession(request, secret) {
  try {
    const cookieHeader = request.headers.get("Cookie") || "";

    const cookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`));

    if (!cookie) return false;

    const token = cookie.slice(COOKIE_NAME.length + 1);
    const parts = token.split(".");

    if (parts.length !== 2) return false;

    const [payload, signature] = parts;
    const key = await getSigningKey(secret);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64url(signature),
      new TextEncoder().encode(payload)
    );

    if (!valid) return false;

    const session = JSON.parse(
      new TextDecoder().decode(fromBase64url(payload))
    );

    return (
      session.admin === true &&
      Number.isFinite(session.expires) &&
      session.expires > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function sessionCookie(value, maxAge = SESSION_DURATION) {
  return (
    `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; ` +
    `SameSite=Strict; Max-Age=${maxAge}`
  );
}

function loginPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paws &amp; Prizes | Admin Login</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#111;color:#f5f0df;font-family:Arial,sans-serif;padding:20px}
main{width:100%;max-width:390px;background:#1d1d1d;padding:30px;
border:1px solid #b9944b;border-radius:14px}
h1{color:#d8b66a;margin-top:0}
p{color:#c9c9c9;line-height:1.5}
label{display:block;margin:18px 0 7px}
input{width:100%;padding:13px;border-radius:6px;border:1px solid #555;
background:#292929;color:white;font-size:16px}
button{width:100%;padding:14px;margin-top:22px;border:0;border-radius:6px;
background:#d8b66a;color:#111;font-weight:bold;font-size:16px;cursor:pointer}
button:disabled{opacity:.6}
#message{color:#ffb2a8;overflow-wrap:anywhere}
</style>
</head>
<body>
<main>
<h1>🐾 Paws &amp; Prizes</h1>
<p>Private administration area. Please sign in.</p>
<form id="login">
<label for="email">Admin email</label>
<input id="email" type="email" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in securely</button>
<p id="message" role="alert"></p>
</form>
</main>
<script>
document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = document.getElementById("message");
  const button = event.target.querySelector("button");

  button.disabled = true;
  message.textContent = "Signing in...";

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Sign-in failed.");
    }

    window.location.replace("/admin");
  } catch (error) {
    message.textContent = error.message || "Unable to sign in.";
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function cleanCompetition(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const result = {};

  for (const field of COMPETITION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      result[field] = body[field];
    }
  }

  if (
    typeof result.title !== "string" ||
    !result.title.trim() ||
    result.title.length > 200
  ) {
    return null;
  }

  for (const field of ["description", "prize", "theme", "rules"]) {
    if (result[field] != null && typeof result[field] !== "string") {
      return null;
    }
  }

  for (const field of ["image_url", "gallery_images"]) {
    if (result[field] != null && typeof result[field] !== "string") {
      return null;
    }
  }

  for (const field of [
    "ticket_price",
    "ticket_quantity",
    "tickets_sold",
    "prize_value",
  ]) {
    if (result[field] != null && result[field] !== "") {
      const number = Number(result[field]);

      if (!Number.isFinite(number) || number < 0) return null;

      if (
        ["ticket_quantity", "tickets_sold"].includes(field) &&
        !Number.isInteger(number)
      ) {
        return null;
      }

      result[field] = number;
    } else if (field in result) {
      result[field] = null;
    }
  }

  if ("status" in result) {
    if (!["draft", "scheduled", "live", "closed"].includes(result.status)) {
      return null;
    }
  }

  for (const field of ["start_date", "closing_date"]) {
    if (
      field in result &&
      result[field] != null &&
      typeof result[field] !== "string"
    ) {
      return null;
    }
  }

  return result;
}

function isAdminPath(path) {
  return (
    path === "/admin" ||
    path === "/admin/" ||
    path === "/admin/index.html"
  );
}

function isLoginPath(path) {
  return path === "/admin/login" || path === "/admin/login/";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      // Health check
      if (path === "/api/health" && method === "GET") {
        return json({ ok: true, service: "paws-and-prizes" });
      }

      // Admin login page
      if (isLoginPath(path) && method === "GET") {
        return html(loginPage());
      }

      // Authenticate administrator
      if (path === "/api/admin/login" && method === "POST") {
        if (
          !env.ADMIN_EMAIL ||
          !env.ADMIN_PASSWORD ||
          !env.SESSION_SECRET
        ) {
          return json(
            { error: "Admin login is not configured correctly." },
            503
          );
        }

        const body = await readBody(request);

        if (
          !body ||
          typeof body.email !== "string" ||
          typeof body.password !== "string"
        ) {
          return json({ error: "Enter your email and password." }, 400);
        }

        const emailOK =
          body.email.trim().toLowerCase() ===
          env.ADMIN_EMAIL.trim().toLowerCase();

        const passwordOK = body.password === env.ADMIN_PASSWORD;

        if (!emailOK || !passwordOK) {
          return json({ error: "Incorrect email or password." }, 401);
        }

        const token = await createSession(env.SESSION_SECRET);

        return json(
          { ok: true },
          200,
          { "Set-Cookie": sessionCookie(token) }
        );
      }

      // Sign out
      if (path === "/api/admin/logout" && method === "POST") {
        return json(
          { ok: true },
          200,
          { "Set-Cookie": sessionCookie("", 0) }
        );
      }

      // Check login status
      if (path === "/api/admin/session" && method === "GET") {
        const authenticated =
          !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);

        return json(
          { authenticated },
          authenticated ? 200 : 401
        );
      }

      // Secure admin dashboard
      if (isAdminPath(path)) {
        const authenticated =
          !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);

        if (!authenticated) {
          return Response.redirect(
            new URL("/admin/login", url.origin).toString(),
            302
          );
        }

        if (!env.ASSETS) {
          return html("Website assets binding ASSETS is missing.", 500);
        }

        const assetURL = new URL("/admin/index.html", url.origin);

        return env.ASSETS.fetch(new Request(assetURL, request));
      }

      // Competition collection
      if (path === "/api/competitions") {
        if (method === "GET") {
          const result = await env.DB.prepare(
            "SELECT * FROM competitions ORDER BY id DESC"
          ).all();

          return json(result.results || []);
        }

        const authenticated =
          !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);

        if (!authenticated) {
          return json({ error: "Please sign in as admin." }, 401);
        }

        if (method === "POST") {
          const body = cleanCompetition(await readBody(request));

          if (!body) {
            return json(
              { error: "Please check the competition details." },
              400
            );
          }

          const fields = COMPETITION_FIELDS.filter(
            (field) => field in body
          );

          const columns = fields.join(", ");
          const placeholders = fields.map(() => "?").join(", ");
          const values = fields.map((field) => body[field]);

          const result = await env.DB.prepare(
            `INSERT INTO competitions (${columns}) VALUES (${placeholders})`
          ).bind(...values).run();

          return json(
            { ok: true, id: result.meta?.last_row_id },
            201
          );
        }

        return json({ error: "Method not allowed." }, 405, {
          Allow: "GET, POST",
        });
      }

      // Update or delete an individual competition
      const competitionMatch = path.match(
        /^\/api\/competitions\/(\d+)$/
      );

      if (competitionMatch) {
        const authenticated =
          !!env.SESSION_SECRET &&
          await validSession(request, env.SESSION_SECRET);

        if (!authenticated) {
          return json({ error: "Please sign in as admin." }, 401);
        }

        const id = Number(competitionMatch[1]);

        if (method === "PUT" || method === "PATCH") {
          const body = cleanCompetition(await readBody(request));

          if (!body) {
            return json(
              { error: "Please check the competition details." },
              400
            );
          }

          const fields = COMPETITION_FIELDS.filter(
            (field) => field in body
          );

          if (fields.length === 0) {
            return json({ error: "There are no changes to save." }, 400);
          }

          const assignments = fields
            .map((field) => `${field} = ?`)
            .join(", ");

          const values = fields.map((field) => body[field]);

          const result = await env.DB.prepare(
            `UPDATE competitions SET ${assignments} WHERE id = ?`
          ).bind(...values, id).run();

          if (!result.meta?.changes) {
            return json({ error: "Competition not found." }, 404);
          }

          return json({ ok: true, id });
        }

        if (method === "DELETE") {
          const result = await env.DB.prepare(
            "DELETE FROM competitions WHERE id = ?"
          ).bind(id).run();

          if (!result.meta?.changes) {
            return json({ error: "Competition not found." }, 404);
          }

          return json({ ok: true, id });
        }

        return json({ error: "Method not allowed." }, 405, {
          Allow: "PUT, PATCH, DELETE",
        });
      }

      // Serve the rest of the website
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({ error: "Website assets are unavailable." }, 500);
    } catch (error) {
      console.error("Paws & Prizes Worker error:", error);

      return json(
        { error: "Something went wrong. Please try again." },
        500
      );
    }
  },
};
