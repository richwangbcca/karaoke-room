import 'dotenv/config';
import express from 'express';
import { spotifyRouter } from '../src/api/spotify';

const app = express();
const port = process.env.PORT || 3000;

app.use('/spotify', spotifyRouter);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// curl "http://localhost:3000/spotify/search?q=beatles&limit=3&market=US"