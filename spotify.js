import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const lastEpisode = 274;
const rssUrl = 'https://feeds.soundcloud.com/users/soundcloud:users:795862234/sounds.rss'; // Substitua pelo feed real

async function checkLatestEpisode() {
  try {
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`Erro ao buscar RSS: ${res.status}`);
    const xml = await res.text();

    const data = await parseStringPromise(xml);
    const items = data.rss.channel[0].item;

    if (!items || items.length === 0) {
      console.log('Não há episódios no feed.');
      return;
    }

    const latest = items[0];
    const title = latest.title[0];
    const pubDate = latest.pubDate[0];

    const match = title.match(/(\d{1,4})/);
    const episodeNum = match ? parseInt(match[1], 10) : null;

    console.log(`Título do último episódio: ${title}`);
    console.log(`Número detectado: ${episodeNum}`);
    console.log(`Publicado a: ${pubDate}`);

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
