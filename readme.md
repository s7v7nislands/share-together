# Share Together

Room-based article sharing for small groups. Users create a room, share the room URL, submit article links, and upvote links worth reading.

The MVP runs on Cloudflare Workers with static assets and D1.

## What Is Built

- Random room creation
- Link-by-URL room access, no login
- URL submission with server-side metadata parsing
- Room-level URL deduplication after tracking parameter cleanup
- Newest and hot sorting
- Upvote-only voting, one vote per browser client id
- Admin deletion using a locally stored room admin key
- Basic rate limiting and SSRF protection

See [prod.md](./prod.md) for product decisions and scope.

## Tech Stack

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Workers Static Assets
- Plain HTML/CSS/JavaScript frontend
- Node test runner for unit tests
- Wrangler for local development and deployment

## Project Layout

```text
.
├── migrations/          D1 schema migrations
├── public/              Static frontend files
├── src/                 Worker API and shared modules
├── test/                Node unit tests
├── package.json         Scripts and dependencies
├── prod.md              Product requirements and decisions
└── wrangler.jsonc       Cloudflare Worker configuration
```

## Prerequisites

- Node.js 20 or newer
- npm
- Cloudflare account for remote deployment
- Wrangler login for remote deployment

Install dependencies:

```bash
npm install
```

## Local Development

Apply the local D1 migration:

```bash
npm run db:migrate:local
```

Start the Worker dev server:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:8787
```

Wrangler stores the local D1 database under `.wrangler/`. That directory is ignored by Git.

## Tests

Run unit tests:

```bash
npm test
```

Current tests cover:

- URL normalization for duplicate detection
- Rejection of unsupported URL schemes
- Local/private network URL blocking
- Open Graph metadata extraction
- Title fallback extraction

## Manual Verification Checklist

After changing API or frontend behavior, verify:

1. Create a room from the home page.
2. Refresh the room URL directly and confirm the room page still loads.
3. Submit a public article URL.
4. Submit the same URL with different `utm_*` parameters and confirm it is treated as a duplicate.
5. Toggle an upvote on and off.
6. Switch between Newest and Hot tabs.
7. Delete a link as the room creator.
8. Check the page at mobile width.

## Cloudflare D1 Setup

Create the remote D1 database:

```bash
npx wrangler d1 create share-together
```

Copy the returned `database_id` into `wrangler.jsonc`:

```jsonc
"database_id": "your-real-d1-database-id"
```

Apply remote migrations:

```bash
npm run db:migrate:remote
```

Deploy:

```bash
npm run deploy
```

## Development Notes

- D1 is the source of truth. KV is not used in the MVP.
- The frontend polls the room API every 15 seconds instead of using WebSockets.
- Metadata parsing is synchronous during URL submission. Failure does not block link creation.
- The app references original `og:image` URLs and does not store or proxy images.
- Links open on the original site in a new tab.
- Room admin keys are returned only at creation time and stored in browser `localStorage`.

## Security Notes

URL fetching is security-sensitive. Keep these constraints intact when changing submission behavior:

- Accept only `http:` and `https:` URLs.
- Block localhost, loopback, link-local, private network, and metadata-service hosts.
- Keep metadata fetches bounded by timeout and response size.
- Keep rate limits on room creation, URL submission, and voting.

The anonymous `client_id` is a product convenience, not strong identity. It prevents accidental duplicate votes from the same browser but does not prevent determined abuse.

## Common Issues

If `wrangler dev` fails because `database_id` is still the placeholder, local mode should still work with the configured database name. Remote commands require a real Cloudflare D1 database id.

If direct navigation to `/room/<slug>` returns the home page or redirects unexpectedly, check the `assets` settings in `wrangler.jsonc`. The app depends on SPA fallback behavior:

```jsonc
"html_handling": "none",
"not_found_handling": "single-page-application"
```

If metadata parsing returns `failed`, the target site may block bots, return non-HTML content, be slow, or omit useful metadata. The link should still be saved.
