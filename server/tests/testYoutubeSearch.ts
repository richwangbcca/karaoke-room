import 'dotenv/config';
import express from 'express';
import { youtubeRouter } from '../src/api/youtube';

const app = express();
const port = process.env.PORT || 3000;

app.use('/youtube', youtubeRouter);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// curl "http://localhost:3000/youtube/search?q=lofi"
