import { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
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

  const addSong = async(title: string, artist: string) => {
    const searchTerm = `${title} ${artist} karaoke`;
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchTerm)}`);
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
    } 
    const data = await res.json();
    console.log(data);

    socket.emit('user:addSong', {
      code: roomCode,
      userId,
      title: `${title}- ${artist}`,
      videoId: data[0].videoId
    }, (resp: any) => {
      if (resp.error) alert(resp.error);
    });
  };

  return (
    <div>
      <h2>What do you want to sing, {name}?</h2>
      <div className="search-bar">
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button onClick={search}><Search size={24}/></button>
      </div>
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <ul>
          {results.map((r) => (
            <li className="search-result" key={r.trackId}>
              <img className="album" src={r.albumImage}/>
              <div className="track-text">
                <p className="track-name">{r.trackName}</p> 
                <p className="artists">{r.artists.join(', ')}</p> 
              </div>
              <button onClick={() => addSong(r.trackName, r.artists[0])}><Plus size={24}/></button>
            </li>
          ))}
        </ul>
      )}

      <h3>Your Queue</h3>
      <ul>
        {queue.filter(q => q.requestedBy === userId).map((q) => (
          <li key={q.id}>{q.title}</li>
        ))}
      </ul>
    </div>
  );
}
