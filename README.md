# Karaoke Room
## Join a room, add your songs, and sing together
A browser-based, real-time karaoke experience. One person hosts a room, everyone else joins from their devices, and the music flows without the hassle of YouTube searches, manual queues, or expensive karaoke machines. Songs are searched via Spotify for accuracy, then autoplayed as high-quality karaoke videos from YouTube on the host's screen.
<img width="1348" height="762" alt="image" src="https://github.com/user-attachments/assets/63878dfa-f9dc-4968-94c3-97efe9b0a8f1" />
<img width="3400" height="1382" alt="image" src="https://github.com/user-attachments/assets/40ccc9c3-920a-4ef8-9c08-df62fcb91173" />


## About the Project
This idea came from a party where I ended up running karaoke while trying to finish a paper on my laptop. Between writing paragraphs and searching YouTube for each shouted song request, I realized there had to be a smoother way. Inspired by Kahoot!, Jackbox Games, and Streamlabs’ media share, Karaoke Room automates the searching, queuing, and playing so everyone can focus on singing.

## Features
Hosts create a room and receive a unique code. Guests then join via this code from their devices. They can search for songs, add them to the queue, and karaoke videos autoplay on the host's screen. Users can manage their personal queue and hosts can manage the global queue and room membership.
### Current Features
- Room-based sessions: Hosts create a room with a 5-character code, others join instantly.
- Spotify-powered search: Ensures accurate track names and artist matching.
- Automatic karaoke video lookup: Finds the best karaoke version on YouTube.
- Real-time queue sync: All users see a personal queue and a global queue, updated instantly.
- Autoplay: Songs play on the hosts's screen without manual intervention.
- Queue management: Users can remove their own songs, and hosts can remove any song, skip the current one, or remove users.
- Concurrent sessions: Multiple rooms can run at the same time without interference.

### Planned Features/Developer TODO
- UI for Spotify search bar
- Randomize messages when no songs are playing
- "Leave Room" button for users
- "Kick User" and "Close Room" controls for hosts
- Utilize cookies for persistent user IDs

## Stack and Tools
- Frontend: TypeScript, React
- Backend: Node.js, socket.io
- APIs: Spotify Web API, YouTube Data API
- Pacakge Management: pnpm workspace

## Installation and Setup
### Prerequisites
- Node.js
- pnpm
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
Set environment variables in .env
```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
YOUTUBE_API_KEY=your_youtube_api_key
```
Start development servers
```
pnpm start
```
## Powered By
- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [YouTube Data API](https://developers.google.com/youtube/v3/getting-started)
