// testRss.js
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

// Último episódio conhecido
const lastEpisode = 112;

// Channel ID do YouTube
const channelId = 'UCWRXJz3wf3QWq56n1MfGAdw';
const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

async function checkLatestEpisode() {
  try {
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`Erro ao buscar RSS: ${res.status}`);
    const xml = await res.text();

    const data = await parseStringPromise(xml);
    const entries = data.feed.entry;

    if (!entries || entries.length === 0) {
      console.log('Não há vídeos no feed.');
      return;
    }

    // O mais recente primeiro
    const latest = entries[0];
    const title = latest['title'][0];
    const videoId = latest['yt:videoId'][0];
    const published = latest['published'][0];

    // Tenta extrair o número do episódio do título (assumindo que tem algo tipo "Ep 113")
    const match = title.match(/(\d{1,4})/);
    const episodeNum = match ? parseInt(match[1], 10) : null;

    console.log(`Título do último vídeo: ${title}`);
    console.log(`Número detectado: ${episodeNum}`);
    console.log(`Publicado a: ${published}`);

    if (episodeNum && episodeNum > lastEpisode) {
      console.log('✅ Novo episódio saiu!');
    } else {
      console.log('⏳ Ainda não saiu um novo episódio.');
    }

  } catch (err) {
    console.error('Erro:', err);
  }
}

checkLatestEpisode();
