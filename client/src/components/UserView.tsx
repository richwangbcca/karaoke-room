import { useState, useEffect } from 'react';
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
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(searchTerm)}`);
    if (!res.ok) {
      console.warn(`Fetch error: ${res.status}`);
    } 
    const data = await res.json();

    setResults(data);
    setLoading(false);
  };

  const addSong = (videoId: string, title: string) => {
    socket.emit('user:addSong', {
      code: roomCode,
      userId,
      title,
      videoId
    }, (resp: any) => {
      if (resp.error) alert(resp.error);
    });
  };

  return (
    <div>
      <h2>What do you want to sing, {name}?</h2>
      <div>
        <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search song" />
        <button onClick={search}>Search</button>
      </div>
      {loading ? (
        <div className="spinner"></div>
      ) : (
        <ul>
          {results.map((r) => (
            <li key={r.videoId}>
              {r.title} <button onClick={() => addSong(r.videoId, r.title)}>Add</button>
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
