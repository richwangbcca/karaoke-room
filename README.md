# Karaoke Room
## Join a room, add your songs, and sing together
A browser-based, real-time karaoke experience. One person hosts a room, everyone else joins from their devices, and the music flows without the hassle of YouTube searches, manual queues, or expensive karaoke machines. Songs are searched via Spotify for accuracy, then autoplayed as high-quality karaoke videos from YouTube on the host's screen.

<img width="3584" height="2155" alt="image" src="https://github.com/user-attachments/assets/4560dd1e-9866-45db-bc13-868a55d41847" />


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

### Planned Features/Developer TODO
- Randomize messages when no songs are playing
- Utilize cookies for persistent user IDs
- Rate limit song lookups per room (YouTube allows only ~100 uncached searches/day by default)

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

# Optional. Only needed if the frontend is hosted on a different origin than the server;
# socket connections are same-origin by default. Comma-separated.
CLIENT_ORIGIN=https://your-frontend.example
```
Start development servers
```
pnpm start
```
## Powered By
- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [YouTube Data API](https://developers.google.com/youtube/v3/getting-started)
