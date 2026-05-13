# Share Together PRD

## Problem Statement

Small groups need a low-friction way to collect and prioritize articles they find across the web. Today this often happens in chat, where links are hard to revisit, duplicate, and lose context quickly.

The product should let anyone in a group paste an article URL into a shared room, have the app extract a useful preview, and let the group upvote the links worth reading. It should feel like a lightweight, room-based Reddit for shared reading, without requiring accounts.

## Solution

Build a Cloudflare-hosted MVP where users create a random room, share the room URL with others, submit article URLs, and browse submitted links sorted by newest or hottest. The app stores only URL records and metadata. It does not host, proxy, or store original images, videos, or article content.

The MVP will use Cloudflare Workers for API routes, Cloudflare D1 for durable storage, and Cloudflare static assets for the browser app. It will use polling rather than WebSockets.

## User Stories

1. As a group organizer, I want to create a room with one click, so that I can start a shared article board quickly.
2. As a group organizer, I want the room URL to be hard to guess, so that only people I share it with can find it.
3. As a room member, I want to open a room link without logging in, so that joining is frictionless.
4. As a room member, I want to paste an article URL, so that the group can see what I found.
5. As a room member, I want submitted URLs to show titles, descriptions, source domains, and thumbnails when available, so that I can scan articles quickly.
6. As a room member, I want URL submission to still work when metadata parsing fails, so that blocked or unusual websites do not break sharing.
7. As a room member, I want duplicate URLs in the same room to be detected, so that the list stays clean.
8. As a room member, I want tracking parameters such as `utm_*` to be ignored for duplicate detection, so that the same article is not duplicated by marketing links.
9. As a room member, I want newest links shown by default, so that I can see what was recently shared.
10. As a room member, I want a hot sort option, so that highly upvoted links are easy to find.
11. As a room member, I want to upvote links once per browser, so that the group can signal what is worth reading.
12. As a room member, I want to remove my upvote, so that I can correct accidental votes.
13. As a room member, I want links to open in a new tab on the original site, so that reading happens at the source.
14. As a room member, I want the page to refresh periodically, so that I can see new submissions without manually reloading.
15. As a room creator, I want an admin capability stored locally, so that I can remove bad links from the room without a full login system.
16. As a room creator, I want deletes to hide links from the room, so that spam or mistakes can be cleaned up.

## Implementation Decisions

- The app is room-based, not one global public community.
- Rooms are created with random, non-user-chosen slugs.
- Room links are the access mechanism. There is no login in the MVP.
- The creator receives an `admin_key`; the frontend stores it in `localStorage` for that room.
- Rooms keep shared records long term.
- The default list sort is newest.
- The hot sort is based on `upvote_count DESC, created_at DESC`.
- The MVP includes URL sharing and upvotes only. Comments are out of scope.
- Voting is upvote-only. Downvotes are out of scope.
- Each browser gets a local anonymous `client_id`.
- A `client_id` can upvote a given link once.
- URL metadata is parsed synchronously during submission with a short timeout and response size cap.
- Metadata parsing failure does not block link creation.
- The app stores original URL, canonical URL, title, description, image URL, source host, timestamps, and vote count.
- Images are referenced from original `og:image` URLs. The app does not store or proxy images.
- Links open in new browser tabs. The app does not iframe articles.
- The MVP uses polling rather than WebSockets or Durable Objects.
- Basic rate limits and SSRF defenses are required in the first version.
- Only `http:` and `https:` URLs are accepted.
- Localhost, private IP, loopback, link-local, and metadata-service destinations are blocked before fetch.
- D1 is the source of truth. KV is not required for the MVP.

## Testing Decisions

- Test behavior at module boundaries rather than internal implementation details.
- URL normalization should be tested because it controls duplicate detection and security-sensitive fetch behavior.
- Metadata extraction should be tested against representative Open Graph, Twitter Card, and plain HTML inputs.
- Database behavior should be exercised through API-level flows where practical.
- Manual browser verification should cover room creation, URL submission, newest/hot sorting, upvote toggling, duplicate handling, and admin deletion.

## Out of Scope

- User accounts, passwords, OAuth, magic links, or member management.
- Comments, nested discussions, notifications, and mentions.
- Downvotes.
- Full-text article extraction or reader mode.
- Hosting uploaded videos, images, PDFs, or article content.
- Cloudflare Stream.
- WebSocket realtime updates.
- Custom room slugs.
- Multiple admins or admin transfer.
- Public discovery of rooms.

## Further Notes

Cloudflare Free can support the MVP shape because the app stores small metadata records and serves a lightweight frontend. The main scaling constraints are Worker daily request limits, D1 read/write limits, and external site fetch reliability. If rooms become highly active, the app can later move from polling to Durable Objects and WebSockets.
