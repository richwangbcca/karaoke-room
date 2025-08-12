import { useState, useEffect } from 'react';
import { Plus, Minus, Search } from 'lucide-react';
import socket from '../socket';

export type UserViewProps = { userName: string; code: string };

export default function UserView({ userName, code }: UserViewProps) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [userId, setUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setName(userName);
    setRoomCode(code.toUpperCase());
  }, [userName, code]);

  useEffect(() => {
    if (!name || !roomCode) return ;
    socket.connect();
    socket.emit('user:joinRoom', { code: roomCode, name }, (res: any) => {
      if (res.error) return alert(res.error);
      setUserId(res.userId);
    });

    socket.on('queue:update', (queue) => {
      setQueue(queue);
    });
  }, [name, roomCode]);

  const search = async () => {
    setLoading(true);
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(searchTerm)}`);
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
    } 
    const data = await res.json();

    setResults(data);
    setLoading(false);
  };

  const addSong = async(title: string, artists: string, albumImage: string) => {
    const searchTerm = `${title} ${artists[0]} karaoke original key`;
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchTerm)}`);
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
    } 
    const data = await res.json();

    socket.emit('user:addSong', {
      code: roomCode,
      userId,
      title: title,
      artists: artists,
      videoId: data[0].videoId,
      albumImage,
    }, (resp: any) => {
      if (resp.error) alert(resp.error);
    });
    setResults([]);
    setSearchTerm("");
  };

  const removeSong = async(songId: string) => {
    socket.emit('user:removeSong', {code: roomCode, songId}, (resp: any) => {
      if (resp.error) alert(resp.error);
    });
  }

  return (
    <div>
      <h2>What do you want to sing, {name}?</h2>
      <form action={search} className="search-bar">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button onClick={search}><Search size={24}/></button>
      </form>
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <ul>
          {results.map((r) => (
            <li className="song-card" key={r.trackId}>
              <img className="album" src={r.albumImage}/>
              <div className="track-text">
                <p className="track-name">{r.trackName}</p> 
                <p className="artists">{r.artists.join(', ')}</p> 
              </div>
              <button onClick={() => addSong(r.trackName, r.artists, r.albumImage)}><Plus size={24}/></button>
            </li>
          ))}
        </ul>
      )}

      <h3>Your Queue</h3>
      <ul>
        {queue.slice(1).filter(q => q.requestedBy === userId).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage}/>
            <div className="track-text">
              <p className="track-name">{q.title}</p> 
              <p className="artists">{q.artists.join(', ')}</p> 
            </div>
            <button onClick={() => removeSong(q.id)}><Minus size={24}/></button>
          </li>
        ))}
      </ul>
      <h3>Global Queue</h3>
      <ul>
        {queue.slice(1).map((q) => (
          <li className="song-card" key={q.id}>
            <img className="album" src={q.albumImage}/>
            <div className="track-text">
              <p className="track-name">{q.title}</p> 
              <p className="artists">{q.artists.join(', ')}</p> 
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
