import { useState } from 'react';
import UserView from './components/UserView';
import HostView from './components/HostView';

function App() {
  const [role, setRole] = useState<'host' | 'user' | null>(null);

  if (!role) {
    return (
      <div className="home">
        <h1>Karaoke Room</h1>
        <h2>Join a room, add your songs, and sing together!</h2>
        <button onClick={() => setRole('host')}>Create a Room</button>
        <button onClick={() => setRole('user')}>Join a Room</button>
        <p>Made by @richwangbcca</p>
      </div>
    );
  }

 return role === 'host' ? <HostView /> : <UserView />;
}

export default App;
