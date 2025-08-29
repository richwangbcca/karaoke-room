import { useState } from 'react';
import UserView from './components/UserView';
import HostView from './components/HostView';

async function validateRoom(roomCode: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/rooms/${roomCode.toUpperCase()}`);
    return response.ok;
  } catch (error) {
    console.error('Unexpected error during room check:', error);
    return false;
  }
}

function App() {
  const [role, setRole] = useState<'host' | 'user' | null>(null);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const joinRoom = async () => {
    if (!name.trim()) {
      setError("Please enter a name.");
      return;
    }
    if (roomCode.length !== 5) {
      setError("Invalid room code");
      return;
    }

    const roomExists = await validateRoom(roomCode);

    if(!roomExists) {
      setError("Room not found");
      return;
    }

    setRole('user');
  }

  if (!role) {
    return (
      <div className="home">
        <h1>Karaoke Room 🎤</h1>
        <h2>Join a room, add your songs, and sing together!</h2>
        <div className="form">
          <div className="input-box">
            <label>Name</label>
            <input placeholder="NAME" maxLength = {12} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="input-box">
            <label>Room Code</label>
            <input placeholder="ROOM CODE" className="code-input" maxLength={5} value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
          </div>
        </div>
          {error && <p className="error">{error}</p>}
          <button onClick={() => joinRoom()}>Join Room</button>
        <div className="host-div">
          <h2>If you're a host</h2>
          <button onClick={() => setRole('host')}>Create a Room</button>
        </div>
        <p>Made by @richwangbcca</p>
      </div>
    );
  }

 return role === 'host' ? 
 <HostView onExit={()=>{ setRole(null); setName(''); setRoomCode(''); }}/> 
 : <UserView userName={name} code={roomCode} onExit={()=>{ setRole(null); setName(''); setRoomCode(''); }}/>;
}

export default App;
