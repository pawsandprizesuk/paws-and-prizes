export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {

      return Response.json({

        ok: true,

        service: "Paws & Prizes API"

      });

    }

    if (url.pathname === "/api/competitions" && request.method === "GET") {

      const { results } = await env.DB.prepare(

        "SELECT * FROM competitions ORDER BY id DESC"

      ).all();

      return Response.json(results);

    }

    if (url.pathname === "/api/competitions" && request.method === "POST") {

      const data = await request.json();

      const result = await env.DB.prepare(`

        INSERT INTO competitions

        (title, description, prize, ticket_price, ticket_quantity, closing_date)

        VALUES (?, ?, ?, ?, ?, ?)

      `).bind(

        data.title,

        data.description,

        data.prize,

        data.ticket_price,

        data.ticket_quantity,

        data.closing_date

      ).run();

      return Response.json({

        success: true,

        id: result.meta.last_row_id

      });

    }

    return env.ASSETS.fetch(request);

  }

};
