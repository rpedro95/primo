import Database from 'better-sqlite3';

const db = new Database('./data/podcast_battle.db');

console.log('📊 Final episode counts by podcast:');
console.log('================================');

const podcasts = db.prepare('SELECT * FROM podcasts').all();

for (const podcast of podcasts) {
  const episodeCount = db.prepare('SELECT COUNT(*) as count FROM episodios WHERE podcast_id = ?').get(podcast.id);
  const latestEpisode = db.prepare('SELECT numero, titulo, data_publicacao FROM episodios WHERE podcast_id = ? ORDER BY numero DESC LIMIT 1').get(podcast.id);
  const oldestEpisode = db.prepare('SELECT numero, titulo, data_publicacao FROM episodios WHERE podcast_id = ? ORDER BY numero ASC LIMIT 1').get(podcast.id);
  
  console.log(`\n📻 ${podcast.nome}:`);
  console.log(`   Total episodes: ${episodeCount.count}`);
  if (latestEpisode) {
    console.log(`   Latest: Ep ${latestEpisode.numero} - ${latestEpisode.titulo}`);
    console.log(`   Date: ${latestEpisode.data_publicacao}`);
  }
  if (oldestEpisode && oldestEpisode.numero !== latestEpisode?.numero) {
    console.log(`   Oldest: Ep ${oldestEpisode.numero} - ${oldestEpisode.titulo}`);
    console.log(`   Date: ${oldestEpisode.data_publicacao}`);
  }
}

db.close();
