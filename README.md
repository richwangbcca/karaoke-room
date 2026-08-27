# Karaoke Room
## Join a room, add your songs, and sing together
A browser-based, real-time karaoke experience. One person hosts a room, everyone else joins from their devices, and the music flows without the hassle of YouTube searches, manual queues, or expensive karaoke machines. Songs are searched via Spotify for accuracy, then autoplayed as high-quality karaoke videos from YouTube on the host's screen.

<img width="1792" height="999" alt="image" src="https://github.com/user-attachments/assets/06ccdb68-6f04-43ff-a049-b06938ec9519" />



## About the Project
This idea came from a party where I ended up running karaoke while trying to finish a paper on my laptop. Between writing paragraphs and searching YouTube for each shouted song request, I realized there had to be a smoother way. Inspired by Kahoot!, Jackbox Games, and Streamlabs’ media share, *Karaoke Room* automates the searching, queuing, and playing so everyone can focus on singing.

## Features
Hosts create a room and receive a unique code. Guests then join via this code from their devices. They can search for songs, add them to the queue, and karaoke videos autoplay on the host's screen. Users can manage their personal queue and hosts can manage the global queue and room membership.
### Current Features
- Room-based sessions: Hosts create a room with a 5-character code, others join instantly.
- Spotify-powered search: Ensures accurate track names and artist matching.
- Automatic karaoke video lookup: Finds the best karaoke version on YouTube with intelligent caching.
- Intelligent YouTube caching: Redis-backed cache keyed on the Spotify track name, so every user requesting a song converges on one lookup. Failed searches are cached too, and concurrent requests for the same song share a single API call.
- Spotify search caching: Repeated searches are served from Redis for 24 hours.
- Real-time queue sync: All users see a personal queue and a global queue, updated instantly.
- Autoplay: Songs play on the hosts's screen without manual intervention.
- Queue management: Users can remove their own songs, and hosts can remove any song, skip the current one, or remove users.
- Concurrent sessions: Multiple rooms can run at the same time without interference.
- Reconnect-safe sessions: a slept phone or a host page refresh reclaims the same room, identity, and queue within a short grace window, using a secret token held on the device.

### Planned Features/Developer TODO
- Randomize messages when no songs are playing

## Stack and Tools
- Frontend: TypeScript, React
- Backend: Node.js, socket.io
- Cache: Redis (YouTube video links and Spotify search results)
- APIs: Spotify Web API, YouTube Data API
- Package Management: pnpm workspace

## Installation and Setup
### Prerequisites
- Node.js
- pnpm
- Redis server
- [Spotify Client ID and Client Secret](https://developer.spotify.com/documentation/web-api/)
- [YouTube API Key](https://developers.google.com/youtube/v3/getting-started)
### Steps
Clone the repository
```
git clone https://github.com/richwangbcca/karaoke-room.git
cd karaoke-room
```
Install dependencies
```
pnpm install
```
Start Redis server. Eviction is left to Redis, so set an LRU policy if you cap its memory:
```
redis-server --maxmemory-policy allkeys-lru
```
Set environment variables in .env
```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
YOUTUBE_API_KEY=your_youtube_api_key
REDIS_URL=redis://localhost:6379

# Optional. Uncached song lookups allowed per 24h, since a YouTube search costs 100 of the
# 10,000 units the free tier grants per day. Raise it if your quota is higher. Default 90.
YOUTUBE_DAILY_SEARCHES=90

# Comma-separated list of the origins the browser loads the page from. Optional in local
# development, where loopback and LAN origins are allowed automatically. REQUIRED once the app is
# reachable from a public hostname - a public origin matches nothing otherwise and every socket
# connection is rejected. The server refuses to start without it when NODE_ENV=production.
CLIENT_ORIGIN=https://your-frontend.example

# Number of reverse proxies in front of the server, so per-IP rate limits key on the real client
# rather than the proxy. Default 0, meaning X-Forwarded-For is ignored entirely.
# IMPORTANT: set this to the actual number of proxies (usually 1) when deploying behind nginx, a
# load balancer, or a PaaS router - otherwise every client looks like the proxy and they all share
# one rate-limit bucket. Do NOT set it higher than the number of proxies that really exist: each
# extra hop is one more attacker-controlled X-Forwarded-For entry that gets trusted.
TRUST_PROXY=0

# Optional. How long (ms) a room or guest is held after a socket drops, so a reconnect can reclaim
# it. Default 45000.
RECONNECT_GRACE_MS=45000

# Optional. Per-IP limits. Everyone at a party is behind one wifi router, and guests on mobile data
# may share a carrier NAT, so these are sized for a whole room rather than one person - raise them
# if you raise the 50-guest room cap. The YouTube quota is protected separately (per socket and by
# the daily budget), which is what actually stops one abusive client.
MAX_SOCKETS_PER_IP=120   # concurrent sockets from one IP
SEARCH_RATE_PER_MIN=300  # /api/spotify/search requests per minute per IP
API_RATE_PER_MIN=600     # all /api requests per minute per IP (a search spends one of these too)
```
### Hosting it publicly
Build both halves and run the compiled server; it serves `client/dist` when that folder exists, so
the whole thing is one process on one origin.
```
pnpm build
NODE_ENV=production CLIENT_ORIGIN=https://your-domain.example pnpm --filter server start
```
`CLIENT_ORIGIN` also decides the HTTPS-only security headers: when it starts with `https://` the
server sends HSTS and `upgrade-insecure-requests`, and when it does not, both are omitted (asserting
them over plain HTTP makes the browser fetch the app's own scripts over TLS that nothing is serving,
and the page renders blank).

Prefer HTTPS in any case. Guests and hosts hold a reconnect token in `localStorage` and send it over
the socket, so on plain HTTP anyone sharing the wifi can read it and take over a room or a guest's
identity. If you would rather not run a separate reverse proxy, [Caddy](https://caddyserver.com)
gets a certificate on its own from a two-line config, and most PaaS hosts terminate TLS for you -
remember to set `TRUST_PROXY=1` whenever something does sit in front.

#### Deploying to Fly.io
A `Dockerfile` and `fly.toml` are included. Websockets need a process that stays up, so the config
keeps one machine running rather than scaling to zero - rooms and reconnect tokens live in memory,
and a stopped machine ends every party on it.
```
fly launch --no-deploy          # reserves an app name and region; keeps the included config
fly redis create                # managed Redis; copy the rediss:// URL it prints
fly secrets set \
  SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... \
  YOUTUBE_API_KEY=... REDIS_URL=rediss://...
fly deploy
fly scale count 1               # REQUIRED - fly launch gives you two machines
fly secrets list                # confirm all four secrets are actually set
```
`REDIS_URL` matters more than it looks. Without it the server falls back to `localhost`, where
nothing is listening, and it logs a warning at boot in production. Searches still work, but nothing
is cached, so the YouTube daily budget is gone within a handful of songs.
Then edit `app` and `CLIENT_ORIGIN` in `fly.toml` to the hostname Fly gave you and deploy again -
the server refuses to boot in production without `CLIENT_ORIGIN`, and rejects sockets from any other
origin. Keep the API keys in `fly secrets`, never in `fly.toml`, which is committed. Note that
`fly launch` rewrites `fly.toml` and drops its comments, so re-check the settings afterwards.

**Run exactly one machine.** `fly launch` provisions two for high availability, which breaks this
app in a way that looks unrelated to scaling: socket.io's polling handshake gets its session id from
one machine and its next poll from the other, which answers `Session ID unknown`, so the client
retries forever and the host screen never leaves "Creating your room...". Websocket-only transport
would hide that but leave a subtler bug, since rooms live in each process's memory and a guest could
land on the machine that does not have their host's room. Serving more than one machine means moving
room state into Redis and adding the socket.io Redis adapter.
```
fly scale count 1               # fix a two-machine deployment
fly status                      # confirm exactly one machine is listed
```
Start development servers
```
pnpm start
```
## Powered By
- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [YouTube Data API](https://developers.google.com/youtube/v3/getting-started)
