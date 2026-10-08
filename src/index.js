export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------------------------------
    // API HEALTH CHECK
    // ---------------------------------

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "Paws & Prizes API"
      });
    }

    // ---------------------------------
    // GET ALL COMPETITIONS
    // ---------------------------------

    if (
      url.pathname === "/api/competitions" &&
      request.method === "GET"
    ) {
      const { results } = await env.DB.prepare(
        "SELECT * FROM competitions ORDER BY id DESC"
      ).all();

      return Response.json(results);
    }

    // ---------------------------------
    // CREATE COMPETITION
    // ---------------------------------

    if (
      url.pathname === "/api/competitions" &&
      request.method === "POST"
    ) {
      const data = await request.json();

      const result = await env.DB.prepare(`
        INSERT INTO competitions
        (
          title,
          description,
          prize,
          ticket_price,
          ticket_quantity,
          closing_date,
          theme,
          image_url,
          gallery_images,
          start_date,
          status,
          tickets_sold,
          rules,
          prize_value
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        data.title,
        data.description,
        data.prize,
        data.ticket_price,
        data.ticket_quantity,
        data.closing_date,
        data.theme,
        data.image_url,
        data.gallery_images,
        data.start_date,
        data.status || "draft",
        data.tickets_sold || 0,
        data.rules,
        data.prize_value
      ).run();

      return Response.json({
        success: true,
        id: result.meta.last_row_id
      });
    }

    // ---------------------------------
    // UPDATE COMPETITION
    // ---------------------------------

    if (
      url.pathname.startsWith("/api/competitions/") &&
      request.method === "PUT"
    ) {
      const id = url.pathname.split("/").pop();
      const data = await request.json();

      await env.DB.prepare(`
        UPDATE competitions
        SET
          title = ?,
          description = ?,
          prize = ?,
          ticket_price = ?,
          ticket_quantity = ?,
          closing_date = ?,
          theme = ?,
          image_url = ?,
          gallery_images = ?,
          start_date = ?,
          status = ?,
          tickets_sold = ?,
          rules = ?,
          prize_value = ?
        WHERE id = ?
      `).bind(
        data.title,
        data.description,
        data.prize,
        data.ticket_price,
        data.ticket_quantity,
        data.closing_date,
        data.theme,
        data.image_url,
        data.gallery_images,
        data.start_date,
        data.status,
        data.tickets_sold,
        data.rules,
        data.prize_value,
        id
      ).run();

      return Response.json({
        success: true
      });
    }

    // ---------------------------------
    // DELETE COMPETITION
    // ---------------------------------

    if (
      url.pathname.startsWith("/api/competitions/") &&
      request.method === "DELETE"
    ) {
      const id = url.pathname.split("/").pop();

      await env.DB.prepare(
        "DELETE FROM competitions WHERE id = ?"
      ).bind(id).run();

      return Response.json({
        success: true
      });
    }

    // ---------------------------------
    // ADMIN
    // ---------------------------------

    if (
      url.pathname === "/admin" ||
      url.pathname === "/admin/"
    ) {
      return env.ASSETS.fetch(
        new Request(
          new URL("/admin/index.html", request.url),
          request
        )
      );
    }

    // ---------------------------------
    // EVERYTHING ELSE
    // ---------------------------------

    return env.ASSETS.fetch(request);
  }
};
