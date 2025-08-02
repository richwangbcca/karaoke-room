/*
Create a two clients-- one that creates a room and one that joins the room as a user.
*/
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected as test client');

  socket.emit('host:createRoom', {}, (res: any) => {
    console.log('Host created room:', res.code);

    // Simulate user joining
    const userSocket = io('http://localhost:3000');
    userSocket.on('connect', () => {
      console.log('User socket connected');

      userSocket.emit(
        'user:joinRoom',
        { code: res.code, name: 'Richard' },
        (reply: any) => {
          console.log('Join room reply:', reply);
        }
      );
    });
  });
});
