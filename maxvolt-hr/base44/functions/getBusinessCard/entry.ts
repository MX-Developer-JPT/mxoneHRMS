import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let slug;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      slug = url.searchParams.get('slug');
    } else {
      const body = await req.json();
      slug = body.slug;
    }

    if (!slug) {
      return Response.json({ error: 'slug is required' }, { status: 400 });
    }

    const cards = await base44.asServiceRole.entities.DigitalBusinessCard.filter({ unique_slug: slug });

    if (!cards || cards.length === 0) {
      return Response.json({ card: null });
    }

    return Response.json({ card: cards[0] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});