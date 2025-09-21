import express from "express";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import multer from "multer";
import webpush from "web-push";

const __dirname = path.resolve();
const app = express();
const PORT = 3000;

// Criar servidor HTTP
const server = createServer(app);

// Criar servidor WebSocket
const wss = new WebSocketServer({ server });

// Armazenar conexões WebSocket por utilizador
const userConnections = new Map();

// Armazenar subscriptions para push notifications
const pushSubscriptions = new Map();

// Configurar web-push (VAPID keys) - DESABILITADO TEMPORARIAMENTE
const vapidKeys = {
  publicKey: 'BKKVK_6hgl_ouZokyTiZs6OcPn3FGXYU_fL05gDrhDMRyHUx4oN8iORcD_zr3i0bkcQK5r4t2Sh-vpeqXVcXN8A',
  privateKey: 'SwKMkc7Hn0KMsbmxJZjoJZNFD1lzKncuFqN6knFRdt0'
};

webpush.setVapidDetails(
  'mailto:podcastbattle@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Configurar multer para upload de imagens
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const imgDir = path.join(__dirname, 'public', 'img');
    if (!fs.existsSync(imgDir)) {
      fs.mkdirSync(imgDir, { recursive: true });
    }
    cb(null, imgDir);
  },
  filename: (req, file, cb) => {
    // Usar o nome do podcast + extensão original
    const podcastName = req.body.nome || 'podcast';
    const cleanName = podcastName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_');
    const ext = path.extname(file.originalname);
    cb(null, `${cleanName}${ext}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Aceitar apenas imagens
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Apenas ficheiros de imagem são permitidos!'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  }
});

// --- Serve static ---
app.use(express.static(path.join(__dirname, 'public')));

// --- DB setup ---
if (!fs.existsSync(path.join(__dirname, "data"))) fs.mkdirSync(path.join(__dirname, "data"));
const db = new Database(path.join(__dirname, "data", "podcast_battle.db"));

// --- WebSocket handling ---
wss.on('connection', (ws, req) => {
  console.log('Nova conexão WebSocket estabelecida');
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'register') {
        // Regista o utilizador
        const { user } = message;
        userConnections.set(user, ws);
        console.log(`Utilizador ${user} registado para notificações`);
        
        // Enviar confirmação
        ws.send(JSON.stringify({
          type: 'registered',
          user: user
        }));
      }
    } catch (error) {
      console.error('Erro ao processar mensagem WebSocket:', error);
    }
  });
  
  ws.on('close', () => {
    // Remove a conexão quando o utilizador se desconecta
    for (const [user, connection] of userConnections.entries()) {
      if (connection === ws) {
        userConnections.delete(user);
        console.log(`Utilizador ${user} desconectado`);
        break;
      }
    }
  });
});

// Função para enviar notificação para um utilizador específico
function sendNotificationToUser(targetUser, notification) {
  console.log(`📤 Enviando notificação para ${targetUser}:`, notification);
  
  const connection = userConnections.get(targetUser);
  if (connection && connection.readyState === 1) { // WebSocket.OPEN
    const messageToSend = {
      type: 'notification',
      ...notification
    };
    
    console.log(`📤 Mensagem WebSocket a enviar:`, messageToSend);
    
    connection.send(JSON.stringify(messageToSend));
    console.log(`✅ Notificação enviada para ${targetUser}`);
    return true;
  } else {
    console.log(`❌ Utilizador ${targetUser} não está conectado`);
    return false;
  }
}

// --- Create tables ---
db.exec(`
CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  link TEXT NOT NULL,
  dia_da_semana TEXT NOT NULL,
  imagem TEXT,
  plataforma TEXT,
  rss TEXT,[]
  channelId TEXT
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS episodios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id TEXT NOT NULL,
  numero TEXT NOT NULL,
  titulo TEXT NOT NULL,
  data_publicacao TEXT NOT NULL,
  FOREIGN KEY(podcast_id) REFERENCES podcasts(id)
);
`);

// Migrar coluna numero de INTEGER para TEXT para suportar números decimais
try {
  db.exec(`ALTER TABLE episodios ADD COLUMN numero_temp INTEGER`);
  db.exec(`UPDATE episodios SET numero_temp = CAST(numero AS INTEGER)`);
  db.exec(`ALTER TABLE episodios DROP COLUMN numero`);
  db.exec(`ALTER TABLE episodios RENAME COLUMN numero_temp TO numero`);
  console.log('✅ Coluna numero migrada para INTEGER (sem decimais)');
} catch (error) {
  console.log('ℹ️ Migração da coluna numero já foi feita ou não é necessária');
}

// Criar tabela ratings com estrutura antiga primeiro
db.exec(`
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id TEXT NOT NULL,
  user TEXT NOT NULL,
  rating INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(podcast_id) REFERENCES podcasts(id),
  UNIQUE(podcast_id, user)
);
`);

// Migrar para nova estrutura com episode_id
try {
  // Verificar se a coluna episode_id já existe
  const columns = db.prepare("PRAGMA table_info(ratings)").all();
  const hasEpisodeId = columns.some(col => col.name === 'episode_id');
  
  if (!hasEpisodeId) {
    console.log('🔄 Migrando tabela ratings para nova estrutura...');
    
    // Criar nova tabela com estrutura correta
    db.exec(`
      CREATE TABLE ratings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        podcast_id TEXT NOT NULL,
        episode_id INTEGER NOT NULL,
        user TEXT NOT NULL,
        rating INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(podcast_id) REFERENCES podcasts(id),
        FOREIGN KEY(episode_id) REFERENCES episodios(id),
        UNIQUE(podcast_id, episode_id, user)
      );
    `);
    
    // Migrar dados existentes (se houver)
    const existingRatings = db.prepare("SELECT * FROM ratings").all();
    if (existingRatings.length > 0) {
      console.log(`📦 Encontrados ${existingRatings.length} ratings para migrar...`);
      
      for (const rating of existingRatings) {
        // Buscar o episódio mais recente do podcast
        const latestEpisode = db.prepare(`
          SELECT id FROM episodios 
          WHERE podcast_id = ? 
          ORDER BY numero DESC 
          LIMIT 1
        `).get(rating.podcast_id);
        
        if (latestEpisode) {
          db.prepare(`
            INSERT INTO ratings_new (podcast_id, episode_id, user, rating, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(rating.podcast_id, latestEpisode.id, rating.user, rating.rating, rating.created_at);
        }
      }
    }
    
    // Remover tabela antiga e renomear nova
    db.exec("DROP TABLE ratings");
    db.exec("ALTER TABLE ratings_new RENAME TO ratings");
    
    console.log('✅ Migração concluída!');
  }
} catch (error) {
  console.error('Erro na migração:', error);
}

// --- Default podcasts ---
const defaultPodcasts = [
  { nome: "watch.tm", link: "https://anchor.fm/s/df67421c/podcast/rss", dia: "domingo", img: "/img/watch.tm.png", plataforma:"spotify", rss:"https://anchor.fm/s/df67421c/podcast/rss" },
  { nome: "à noite mata", link: "https://open.spotify.com/show/0PL5pILKjANwZ8UK9KtbqF?si=dda4315119f642fe", dia: "segunda", img: "/img/NoiteMata.png", plataforma:"spotify", rss:"https://anchor.fm/s/db97b450/podcast/rss" },
  { nome: "desnorte", link: "https://open.spotify.com/show/1FuehRKqgMbl7d8KDUoSEa?si=aeea5574e45744cb", dia: "segunda", img: "/img/Desnorte.png", plataforma:"soundcloud", rss:"https://feeds.soundcloud.com/users/soundcloud:users:795862234/sounds.rss" },
  { nome: "Zé Carioca", link: "https://podcasters.spotify.com/pod/show/ze-carioca", dia: "segunda", img: "/img/ZeCarioca.png", plataforma:"spotify", rss:"https://anchor.fm/s/ea5b58fc/podcast/rss" },
  { nome: "Cubinho", link: "https://open.spotify.com/show/2JLsy53hzl94Wn1GxqTzoD?si=d2701cbd233a4e1a", dia: "terça", img: "/img/Cubinho.png", plataforma:"spotify", rss:"https://anchor.fm/s/8e11a8d0/podcast/rss" },
  { nome: "Prata da Casa", link: "https://anchor.fm/s/1056d2710/podcast/rss", dia: "quarta", img: "/img/PrataDaCasa.png", plataforma:"spotify", rss:"https://anchor.fm/s/1056d2710/podcast/rss" },
  { nome: "Contraluz", link: "https://open.spotify.com/show/1iZVOcN0N79eR83v6g0UC9?si=3378ba9f5b0849db", dia: "sábado", img: "/img/Contraluz.png", plataforma:"spotify", rss:"https://anchor.fm/s/fb86963c/podcast/rss" },
  { nome: "Trocadilho", link: "https://open.spotify.com/show/7L4zV1ZWetD7aEyfaMZB10?si=31ea176718944bf4", dia: "sábado", img: "/img/Trocadilho.png", plataforma:"spotify", rss:"https://anchor.fm/s/3d61c0b4/podcast/rss" },
];

// --- Insert default podcasts if not exist ---
const insertPodcast = db.prepare(`
  INSERT OR IGNORE INTO podcasts (id,nome,link,dia_da_semana,imagem,plataforma,rss,channelId)
  VALUES (@id,@nome,@link,@dia_da_semana,@imagem,@plataforma,@rss,@channelId)
`);
for (const p of defaultPodcasts) {
  insertPodcast.run({
    id: Buffer.from(p.nome).toString('base64url').slice(0,20),
    nome: p.nome,
    link: p.link,
    dia_da_semana: p.dia,
    imagem: p.img,
    plataforma: p.plataforma,
    rss: p.rss || null,
    channelId: p.channelId || null
  });
}

// --- Helper: week order ---
const weekOrder = ["domingo","segunda","terça","quarta","quinta","sexta","sábado"];

// Helper function to get the start of the current week (Sunday)
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day; // Subtract days to get to Sunday
  const weekStart = new Date(d.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

// Helper function to get the start of the week for a specific podcast day
function getWeekStartForPodcast(date, podcastDay) {
  const d = new Date(date);
  const currentDay = d.getDay();
  const podcastDayIndex = weekOrder.indexOf(podcastDay);
  
  // Calculate days to subtract to get to the podcast's day this week
  let daysToSubtract = currentDay - podcastDayIndex;
  if (daysToSubtract < 0) {
    daysToSubtract += 7; // If podcast day hasn't happened this week, go to next week
  }
  
  // Get the start of the current week (Sunday)
  const weekStart = getWeekStart(d);
  
  // Add days to get to the podcast's day this week
  const podcastWeekStart = new Date(weekStart);
  podcastWeekStart.setDate(weekStart.getDate() + podcastDayIndex);
  podcastWeekStart.setHours(0, 0, 0, 0);
  
  return podcastWeekStart;
}

// --- Funções para carregar de ficheiros ---
async function loadWatchTmFromFile(podcastId) {
  try {
    console.log('📁 Carregando watch.tm do ficheiro...');
    const fs = await import('fs');
    const fileContent = fs.readFileSync('./data/watchtm.txt', 'utf8');
    
    // Parse the file content (assuming it's similar to velhoamigo.txt format)
    const episodes = parseRssFromString(fileContent);
    
    console.log(`📅 Encontrados ${episodes.length} episódios no ficheiro`);
    
    // Insert episodes into database
    for (const episode of episodes) {
      try {
        db.prepare(`
          INSERT INTO episodios (podcast_id, numero, titulo, data_publicacao, link)
          VALUES (?, ?, ?, ?, ?)
        `).run(podcastId, episode.episodeNum, episode.title, episode.pubDate.toISOString(), episode.link || '');
      } catch (err) {
        console.log(`   ⚠️ Erro ao inserir episódio ${episode.episodeNum}: ${err.message}`);
      }
    }
    
    console.log(`✅ watch.tm carregado: ${episodes.length} episódios`);
  } catch (error) {
    console.error('❌ Erro ao carregar watch.tm do ficheiro:', error);
  }
}

async function loadPrataDaCasaFromFile(podcastId) {
  try {
    console.log('📁 Carregando Prata da Casa do ficheiro...');
    const fs = await import('fs');
    const fileContent = fs.readFileSync('./data/pratadacasa.txt', 'utf8');
    
    // Parse the file content (assuming it's similar to velhoamigo.txt format)
    const episodes = parseRssFromString(fileContent);
    
    console.log(`📅 Encontrados ${episodes.length} episódios no ficheiro`);
    
    // Insert episodes into database
    for (const episode of episodes) {
      try {
        db.prepare(`
          INSERT INTO episodios (podcast_id, numero, titulo, data_publicacao, link)
          VALUES (?, ?, ?, ?, ?)
        `).run(podcastId, episode.episodeNum, episode.title, episode.pubDate.toISOString(), episode.link || '');
      } catch (err) {
        console.log(`   ⚠️ Erro ao inserir episódio ${episode.episodeNum}: ${err.message}`);
      }
    }
    
    console.log(`✅ Prata da Casa carregado: ${episodes.length} episódios`);
  } catch (error) {
    console.error('❌ Erro ao carregar Prata da Casa do ficheiro:', error);
  }
}

// --- Funções de RSS/YouTube ---
async function getLastEpisode(podcastId) {
  const row = db.prepare(`SELECT numero, data_publicacao FROM episodios WHERE podcast_id = ? ORDER BY numero DESC LIMIT 1`).get(podcastId);
  return row || { numero: 0, data_publicacao: null };
}

async function checkRssPodcast(podcast) {
  try {
    const res = await fetch(podcast.rss);
    if (!res.ok) throw new Error(`Erro ao buscar RSS: ${res.status}`);
    const xml = await res.text();
    const data = await parseStringPromise(xml);
    const items = data.rss.channel[0].item;
    if (!items || items.length === 0) return null;
    const latest = items[0];
    const title = latest.title[0];
    const pubDate = new Date(latest.pubDate[0]);
    const match = title.match(/(\d{1,4})/);
    const episodeNum = match ? parseInt(match[1],10) : null;
    return { episodeNum, title, pubDate };
  } catch(err) { console.error(`Erro RSS podcast ${podcast.nome}:`, err); return null; }
}

async function checkYoutubePodcast(podcast) {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${podcast.channelId}`;
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`Erro ao buscar RSS YouTube: ${res.status}`);
    const xml = await res.text();
    const data = await parseStringPromise(xml);
    const entries = data.feed.entry;
    if (!entries || entries.length === 0) return null;
    const latest = entries[0];
    const title = latest['title'][0];
    const pubDate = new Date(latest['published'][0]);
    const match = title.match(/(\d{1,4})/);
    const episodeNum = match ? parseInt(match[1],10) : null;
    return { episodeNum, title, pubDate };
  } catch(err) { console.error(`Erro YouTube podcast ${podcast.nome}:`, err); return null; }
}

async function updatePodcasts() {
  const podcasts = db.prepare(`SELECT * FROM podcasts`).all();
  const today = new Date();
  const currentWeekStart = getWeekStart(today);
  
  for(const podcast of podcasts){
    const lastEp = await getLastEpisode(podcast.id);
    
    // Skip if we already have an episode from this week
    if (lastEp && lastEp.data_publicacao) {
      const episodeDate = new Date(lastEp.data_publicacao);
      if (episodeDate >= currentWeekStart) {
        console.log(`⏭️  ${podcast.nome}: Já tem episódio desta semana (Ep ${lastEp.numero})`);
        continue;
      }
    }
    
    console.log(`🔍 Verificando ${podcast.nome}...`);
    let latest = null;
    if(podcast.plataforma==="spotify" || podcast.plataforma==="soundcloud"){
      latest = await checkRssPodcast(podcast);
    } else if(podcast.plataforma==="youtube"){
      latest = await checkYoutubePodcast(podcast);
    }
    if(!latest) continue;
    if(latest.episodeNum && latest.episodeNum>lastEp.numero){
      console.log(`✅ Novo episódio para ${podcast.nome}: Ep ${latest.episodeNum}`);
      db.prepare(`INSERT INTO episodios (podcast_id,numero,titulo,data_publicacao) VALUES (?,?,?,?)`)
        .run(podcast.id, latest.episodeNum, latest.title, latest.pubDate.toISOString());
    }
  }
}

// Função para preencher todos os históricos dos podcasts
async function fillAllPodcastHistories() {
  console.log('🚀 Iniciando preenchimento de todos os históricos...');
  const podcasts = db.prepare(`SELECT * FROM podcasts`).all();
  
  for(const podcast of podcasts){
    console.log(`\n📚 Preenchendo histórico de ${podcast.nome}...`);
    
    try {
      let episodes = [];
      
      if(podcast.plataforma === "spotify" || podcast.plataforma === "soundcloud"){
        episodes = await getAllRssEpisodes(podcast);
      } else if(podcast.plataforma === "youtube"){
        episodes = await getAllYoutubeEpisodes(podcast);
      }
      
      if(episodes && episodes.length > 0){
        console.log(`   📥 Encontrados ${episodes.length} episódios para ${podcast.nome}`);
        
        // Inserir episódios na base de dados (ignorar duplicados)
        const insertEpisode = db.prepare(`
          INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao) 
          VALUES (?, ?, ?, ?)
        `);
        
        let addedCount = 0;
        for(const episode of episodes){
          const result = insertEpisode.run(
            podcast.id, 
            episode.episodeNum, 
            episode.title, 
            episode.pubDate.toISOString()
          );
          if(result.changes > 0) addedCount++;
        }
        
        console.log(`   ✅ Adicionados ${addedCount} novos episódios para ${podcast.nome}`);
      } else {
        console.log(`   ⚠️  Nenhum episódio encontrado para ${podcast.nome}`);
      }
      
    } catch(error) {
      console.error(`   ❌ Erro ao preencher ${podcast.nome}:`, error.message);
    }
  }
  
  console.log('\n🎉 Preenchimento de históricos concluído!');
}

// Função para preencher histórico de um podcast específico
async function fillPodcastHistory(podcast) {
  console.log(`\n📚 Preenchendo histórico de ${podcast.nome}...`);
  
  try {
    let episodes = [];
    
    if(podcast.plataforma === "spotify" || podcast.plataforma === "soundcloud"){
      episodes = await getAllRssEpisodes(podcast);
    } else if(podcast.plataforma === "youtube"){
      episodes = await getAllYoutubeEpisodes(podcast);
    }
    
    if(episodes && episodes.length > 0){
      console.log(`   📥 Encontrados ${episodes.length} episódios para ${podcast.nome}`);
      
      // Inserir episódios na base de dados (ignorar duplicados)
      const insertEpisode = db.prepare(`
        INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao) 
        VALUES (?, ?, ?, ?)
      `);
      
      let addedCount = 0;
      for(const episode of episodes){
        const result = insertEpisode.run(
          podcast.id, 
          episode.episodeNum, 
          episode.title, 
          episode.pubDate.toISOString()
        );
        if(result.changes > 0) addedCount++;
      }
      
      console.log(`   ✅ Adicionados ${addedCount} novos episódios para ${podcast.nome}`);
      return { success: true, addedCount, totalFound: episodes.length };
    } else {
      console.log(`   ⚠️  Nenhum episódio encontrado para ${podcast.nome}`);
      return { success: true, addedCount: 0, totalFound: 0 };
    }
    
  } catch(error) {
    console.error(`   ❌ Erro ao preencher ${podcast.nome}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Função para buscar todos os episódios de um podcast RSS
async function getAllRssEpisodes(podcast) {
  try {
    const res = await fetch(podcast.rss);
    if (!res.ok) throw new Error(`Erro ao buscar RSS: ${res.status}`);
    const xml = await res.text();
    const data = await parseStringPromise(xml);
    const items = data.rss.channel[0].item;
    
    if (!items || items.length === 0) return [];
    
    // Parsing específico para Zé Carioca
    if (podcast.nome === 'Zé Carioca') {
      return getAllZeCariocaRssEpisodes(items);
    }

    // Parsing específico para Prata da Casa
    if (podcast.nome === 'Prata da Casa') {
      return getAllPrataDaCasaRssEpisodes(items);
    }

    // Parsing específico para Velho amigo
    if (podcast.nome === 'Velho amigo') {
      return getAllVelhoAmigoRssEpisodes(items);
    }
    
    // Parsing genérico para outros podcasts RSS
    const episodes = items.map((item, index) => {
      const title = item.title[0];
      const pubDate = new Date(item.pubDate[0]);
      
      // Tentar extrair número do título, senão usar posição no RSS
      const match = title.match(/(\d{1,4})/);
      const episodeNum = match ? parseInt(match[1], 10) : (items.length - index);
      
      return { episodeNum, title, pubDate };
    });
    
    // Ordenar por número do episódio (crescente)
    return episodes.sort((a, b) => a.episodeNum - b.episodeNum);
    
  } catch(err) { 
    console.error(`Erro RSS podcast ${podcast.nome}:`, err); 
    return []; 
  }
}

// Função específica para parsing do watch.tm via RSS
async function getAllWatchTmRssEpisodes(items) {
  console.log('🎬 Parsing específico para watch.tm RSS...');
  
  const episodes = [];
  
  for (const item of items) {
    const title = item.title[0];
    const pubDate = new Date(item.pubDate[0]);
    
    // Verificar se o título segue o formato: "título | #número"
    const watchTmPattern = /^(.+?)\s*\|\s*#(\d{1,4})$/i;
    const match = title.match(watchTmPattern);
    
    if (match) {
      const episodeTitle = match[1].trim();
      const episodeNum = parseInt(match[2], 10);
      
      episodes.push({
        episodeNum,
        title: episodeTitle,
        pubDate
      });
      
      console.log(`   ✅ Episódio válido: #${episodeNum} - ${episodeTitle}`);
    } else {
      console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
    }
  }
  
  // Ordenar por número do episódio (crescente)
  const sortedEpisodes = episodes.sort((a, b) => a.episodeNum - b.episodeNum);
  
  console.log(`🎬 Total de episódios watch.tm válidos: ${sortedEpisodes.length}`);
  return sortedEpisodes;
}

// Função específica para parsing do Zé Carioca via RSS
async function getAllZeCariocaRssEpisodes(items) {
  console.log('🎭 Parsing específico para Zé Carioca RSS...');
  
  const episodes = [];
  
  for (const item of items) {
    const title = item.title[0];
    const pubDate = new Date(item.pubDate[0]);
    
    // Verificar se o título segue o formato: "número : título"
    const zeCariocaPattern = /^(\d{1,4})\s*:\s*(.+)$/i;
    const match = title.match(zeCariocaPattern);
    
    if (match) {
      const episodeNum = parseInt(match[1], 10);
      const episodeTitle = match[2].trim();
      
      episodes.push({
        episodeNum,
        title: episodeTitle,
        pubDate
      });
      
      console.log(`   ✅ Episódio válido: #${episodeNum} - ${episodeTitle}`);
    } else {
      console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
    }
  }
  
  // Ordenar por número do episódio (crescente)
  const sortedEpisodes = episodes.sort((a, b) => a.episodeNum - b.episodeNum);
  
  console.log(`🎭 Total de episódios Zé Carioca válidos: ${sortedEpisodes.length}`);
  return sortedEpisodes;
}

// Função específica para parsing do Prata da Casa via RSS
async function getAllPrataDaCasaRssEpisodes(items) {
  console.log('💎 Parsing específico para Prata da Casa RSS...');
  
  const episodes = [];
  
  for (const item of items) {
    const title = item.title[0];
    const pubDate = new Date(item.pubDate[0]);
    
    // Verificar se o título segue o formato: "Prata da Casa #XX - Título"
    const prataDaCasaPattern = /^Prata da Casa #(\d{1,4})\s*-\s*(.+)$/i;
    const match = title.match(prataDaCasaPattern);
    
    if (match) {
      const episodeNum = parseInt(match[1], 10);
      const episodeTitle = match[2].trim();
      
      episodes.push({
        episodeNum,
        title: episodeTitle,
        pubDate
      });
      
      console.log(`   ✅ Episódio válido: #${episodeNum} - ${episodeTitle}`);
    } else {
      console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
    }
  }
  
  // Ordenar por número do episódio (crescente)
  const sortedEpisodes = episodes.sort((a, b) => a.episodeNum - b.episodeNum);
  console.log(`💎 Total de episódios Prata da Casa válidos: ${sortedEpisodes.length}`);
  return sortedEpisodes;
}

// Função específica para parsing do Velho amigo via RSS
function getAllVelhoAmigoRssEpisodes(items) {
  console.log('👴 Parsing específico para Velho amigo RSS...');
  
  const episodes = [];
  
  for (const item of items) {
    const title = item.title[0];
    const pubDate = new Date(item.pubDate[0]);
    
    // Para Velho amigo, procurar por #número no final do título
    // Aceitar números decimais como 0.1, 0.3, 0.95, etc.
    // Formato: "título | #número" (incluindo 0.95, 0.9, etc.)
    const match = title.match(/\|\s*#(\d+(?:\.\d+)?)$/);
    if (match) {
      const numberStr = match[1];
      let episodeNum;
      
      // Se for um número decimal (0.1, 0.3, etc.), manter como string
      if (numberStr.includes('.')) {
        episodeNum = numberStr; // Manter como "0.95" em vez de "95"
      } else {
        // Para números inteiros, manter como inteiro (não converter para float)
        episodeNum = parseInt(numberStr, 10);
      }
      
      // MANTER o título exatamente como vem do ficheiro (não limpar)
      episodes.push({
        episodeNum,
        title: title, // Título original sem modificações
        pubDate
      });
      
      console.log(`   ✅ Episódio válido: #${episodeNum} - ${title.substring(0, 50)}...`);
    } else {
      // Debug: mostrar títulos que não fazem match
      if (title.includes('amizade') || title.includes('0.95')) {
        console.log(`   🔍 DEBUG - Título sem match: "${title}"`);
      }
    }
  }
  
  // Ordenar por número do episódio (crescente)
  const sortedEpisodes = episodes.sort((a, b) => {
    // Para números decimais (strings), converter para float para comparação
    // Para números inteiros, usar diretamente
    const aNum = typeof a.episodeNum === 'string' ? parseFloat(a.episodeNum) : a.episodeNum;
    const bNum = typeof b.episodeNum === 'string' ? parseFloat(b.episodeNum) : b.episodeNum;
    return aNum - bNum;
  });
  
  console.log(`👴 Total de episódios Velho amigo válidos: ${sortedEpisodes.length}`);
  return sortedEpisodes;
}

// Função para buscar todos os episódios de um canal YouTube
async function getAllYoutubeEpisodes(podcast) {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${podcast.channelId}`;
    const res = await fetch(rssUrl);
    if (!res.ok) throw new Error(`Erro ao buscar RSS YouTube: ${res.status}`);
    const xml = await res.text();
    const data = await parseStringPromise(xml);
    const entries = data.feed.entry;
    
    if (!entries || entries.length === 0) return [];
    
    // Parsing específico para watch.tm
    if (podcast.nome === 'watch.tm') {
      return getAllWatchTmEpisodes(entries);
    }
    
    // Parsing genérico para outros podcasts YouTube
    const episodes = entries.map(entry => {
      const title = entry['title'][0];
      const pubDate = new Date(entry['published'][0]);
      const match = title.match(/(\d{1,4})/);
      const episodeNum = match ? parseInt(match[1], 10) : null;
      
      return { episodeNum, title, pubDate };
    }).filter(ep => ep.episodeNum !== null); // Só episódios com número válido
    
    // Ordenar por número do episódio (crescente)
    return episodes.sort((a, b) => a.episodeNum - b.episodeNum);
    
  } catch(err) { 
    console.error(`Erro YouTube podcast ${podcast.nome}:`, err); 
    return []; 
  }
}

// Função específica para parsing do watch.tm
async function getAllWatchTmEpisodes(entries) {
  console.log('🎬 Parsing específico para watch.tm...');
  
  const episodes = [];
  
  for (const entry of entries) {
    const title = entry['title'][0];
    const pubDate = new Date(entry['published'][0]);
    
    // Verificar se o título segue o formato: "título | watch.tm {número}"
    const watchTmPattern = /^(.+?)\s*\|\s*watch\.tm\s+(\d{1,4})$/i;
    const match = title.match(watchTmPattern);
    
    if (match) {
      const episodeTitle = match[1].trim();
      const episodeNum = parseInt(match[2], 10);
      
      episodes.push({
        episodeNum,
        title: episodeTitle,
        pubDate
      });
      
      console.log(`   ✅ Episódio válido: #${episodeNum} - ${episodeTitle}`);
    } else {
      console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
    }
  }
  
  // Ordenar por número do episódio (crescente)
  const sortedEpisodes = episodes.sort((a, b) => a.episodeNum - b.episodeNum);
  
  console.log(`🎬 Total de episódios watch.tm válidos: ${sortedEpisodes.length}`);
  return sortedEpisodes;
}

// --- API: podcasts ---
app.get('/api/podcasts', async (req,res)=>{
  // Verificar episódios sempre que a página é aberta
  console.log('🔄 Verificando episódios...');
  await updatePodcasts();
  
  const rows = db.prepare(`SELECT * FROM podcasts`).all();
  const today = new Date();
  const weekDay = today.toLocaleDateString('pt-PT',{ weekday:'long' }).toLowerCase();

  const podcasts = rows.map(p=>{
    const lastEp = db.prepare(`SELECT numero, data_publicacao FROM episodios WHERE podcast_id = ? ORDER BY numero DESC LIMIT 1`).get(p.id);
    
    // Check if episode is from current week (since last Sunday)
    let ja_saiu;
    if (lastEp && lastEp.data_publicacao) {
      const episodeDate = new Date(lastEp.data_publicacao);
      const today = new Date();
      
      // Get the start of the current week (Sunday)
      const currentWeekStart = getWeekStart(today);
      
      console.log(`Podcast: ${p.nome}, Episode date: ${episodeDate.toISOString()}, Current week start: ${currentWeekStart.toISOString()}`);
      
      // Episode is out if it's from the current week (since last Sunday)
      ja_saiu = episodeDate >= currentWeekStart;
      console.log(`ja_saiu: ${ja_saiu} (episode >= current week start: ${episodeDate >= currentWeekStart})`);
    } else {
      // If no episode data, check if we're past the podcast's day this week
      ja_saiu = weekOrder.indexOf(weekDay) >= weekOrder.indexOf(p.dia_da_semana);
      console.log(`Podcast: ${p.nome}, No episode data, ja_saiu: ${ja_saiu} (current day: ${weekDay}, podcast day: ${p.dia_da_semana})`);
    }
    
    // Get ratings for Pedro and João (do episódio mais recente)
    const latestEpisode = db.prepare(`SELECT id FROM episodios WHERE podcast_id = ? ORDER BY numero DESC LIMIT 1`).get(p.id);
    let ratingPedro = null;
    let ratingJoao = null;
    
    if (latestEpisode) {
      ratingPedro = db.prepare(`SELECT rating FROM ratings WHERE podcast_id = ? AND episode_id = ? AND user = 'Pedro'`).get(p.id, latestEpisode.id);
      ratingJoao = db.prepare(`SELECT rating FROM ratings WHERE podcast_id = ? AND episode_id = ? AND user = 'João'`).get(p.id, latestEpisode.id);
    }
    
    return { 
      ...p, 
      ja_saiu,
      ratingPedro: ratingPedro ? ratingPedro.rating : 0,
      ratingJoao: ratingJoao ? ratingJoao.rating : 0
    };
  });

  podcasts.sort((a,b)=> weekOrder.indexOf(a.dia_da_semana)-weekOrder.indexOf(b.dia_da_semana));
  res.json({ podcasts });
});

// --- API: rate podcast ---
app.post('/api/rate', express.json(), (req,res)=>{
  console.log('Received rating request:', req.body);
  const { podcastId, episodeId, user, rating } = req.body;
  
  console.log('Parsed data:', { podcastId, episodeId, user, rating });
  console.log('Validation:', {
    hasPodcastId: !!podcastId,
    hasEpisodeId: !!episodeId,
    hasUser: !!user,
    hasRating: !!rating,
    ratingType: typeof rating,
    ratingValue: rating,
    isInRange: rating >= 1 && rating <= 10
  });
  
  if (!podcastId || !user || !rating || rating < 1 || rating > 10) {
    console.log('Validation failed, returning 400');
    return res.status(400).json({ error: 'Invalid rating data' });
  }
  
  try {
    let targetEpisodeId = episodeId;
    
    // Se não foi fornecido episodeId, buscar o episódio mais recente do podcast
    if (!episodeId) {
      const latestEpisode = db.prepare(`
        SELECT id FROM episodios 
        WHERE podcast_id = ? 
        ORDER BY numero DESC 
        LIMIT 1
      `).get(podcastId);
      
      if (!latestEpisode) {
        return res.status(404).json({ error: 'No episode found for this podcast' });
      }
      
      targetEpisodeId = latestEpisode.id;
    } else {
      // Verificar se o episodeId existe e pertence ao podcast
      const episode = db.prepare(`
        SELECT id FROM episodios 
        WHERE id = ? AND podcast_id = ?
      `).get(episodeId, podcastId);
      
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found or does not belong to this podcast' });
      }
    }
    
    const insertRating = db.prepare(`
      INSERT OR REPLACE INTO ratings (podcast_id, episode_id, user, rating) 
      VALUES (?, ?, ?, ?)
    `);
    insertRating.run(podcastId, targetEpisodeId, user, rating);
    console.log(`Rating saved successfully for episode ${targetEpisodeId}`);
    res.json({ success: true, episodeId: targetEpisodeId });
  } catch (error) {
    console.error('Error saving rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// --- API: clear rating ---
app.delete('/api/rate', express.json(), (req,res)=>{
  console.log('Received clear rating request:', req.body);
  const { podcastId, episodeId, user } = req.body;

  if (!podcastId || !user) {
    return res.status(400).json({ error: 'Missing podcastId or user' });
  }

  try {
    let targetEpisodeId = episodeId;
    
    // Se não foi fornecido episodeId, buscar o episódio mais recente do podcast
    if (!episodeId) {
      const latestEpisode = db.prepare(`
        SELECT id FROM episodios 
        WHERE podcast_id = ? 
        ORDER BY numero DESC 
        LIMIT 1
      `).get(podcastId);
      
      if (!latestEpisode) {
        return res.status(404).json({ error: 'No episode found for this podcast' });
      }
      
      targetEpisodeId = latestEpisode.id;
    } else {
      // Verificar se o episodeId existe e pertence ao podcast
      const episode = db.prepare(`
        SELECT id FROM episodios 
        WHERE id = ? AND podcast_id = ?
      `).get(episodeId, podcastId);
      
      if (!episode) {
        return res.status(404).json({ error: 'Episode not found or does not belong to this podcast' });
      }
    }
    
    const deleteRating = db.prepare(`
      DELETE FROM ratings WHERE podcast_id = ? AND episode_id = ? AND user = ?
    `);
    const result = deleteRating.run(podcastId, targetEpisodeId, user);
    console.log('Rating cleared successfully');
    res.json({ success: true, deleted: result.changes > 0 });
  } catch (error) {
    console.error('Error clearing rating:', error);
    res.status(500).json({ error: 'Failed to clear rating' });
  }
});

// --- API: subscribe to push notifications ---
app.post('/api/subscribe', express.json(), (req, res) => {
  console.log('Received push subscription request:', req.body);
  const { user, subscription } = req.body;

  if (!user || !subscription) {
    return res.status(400).json({ error: 'Missing user or subscription data' });
  }

  try {
    // Guardar subscription
    pushSubscriptions.set(user, subscription);
    console.log(`Push subscription saved for user: ${user}`);
    
    res.json({ 
      success: true, 
      message: 'Push subscription saved successfully' 
    });
  } catch (error) {
    console.error('Error saving push subscription:', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

// --- API: get VAPID public key ---
app.get('/api/vapid-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// --- API: get episodes for a podcast ---
app.get('/api/episodes/:podcastId', (req, res) => {
  const { podcastId } = req.params;
  
  if (!podcastId) {
    return res.status(400).json({ error: 'Missing podcastId' });
  }
  
  try {
    // Buscar episódios do podcast com ratings específicos por episódio
    const episodes = db.prepare(`
      SELECT e.id, e.numero, e.titulo, e.data_publicacao,
             rp.rating as ratingPedro, rj.rating as ratingJoao
      FROM episodios e
      LEFT JOIN ratings rp ON e.id = rp.episode_id AND rp.user = 'Pedro'
      LEFT JOIN ratings rj ON e.id = rj.episode_id AND rj.user = 'João'
      WHERE e.podcast_id = ?
      ORDER BY e.numero DESC
    `).all(podcastId);
    
    res.json({ episodes });
  } catch (error) {
    console.error('Error fetching episodes:', error);
    res.status(500).json({ error: 'Failed to fetch episodes' });
  }
});

// Endpoint para apagar um podcast específico e todos os seus dados
app.delete('/api/podcast/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    console.log(`🗑️ Apagando podcast ${id} e todos os dados associados...`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    
    // Primeiro apagar todos os ratings do podcast
    const deleteRatings = db.prepare('DELETE FROM ratings WHERE podcast_id = ?');
    const ratingsResult = deleteRatings.run(id);
    console.log(`🗑️ Apagados ${ratingsResult.changes} ratings`);
    
    // Depois apagar todos os episódios do podcast
    const deleteEpisodes = db.prepare('DELETE FROM episodios WHERE podcast_id = ?');
    const episodesResult = deleteEpisodes.run(id);
    console.log(`🗑️ Apagados ${episodesResult.changes} episódios`);
    
    // Por fim apagar o podcast
    const deletePodcast = db.prepare('DELETE FROM podcasts WHERE id = ?');
    const podcastResult = deletePodcast.run(id);
    console.log(`🗑️ Apagado ${podcastResult.changes} podcast`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    
    if (podcastResult.changes === 0) {
      return res.status(404).json({ error: 'Podcast não encontrado' });
    }
    
    res.json({ 
      success: true, 
      message: 'Podcast, episódios e ratings apagados com sucesso',
      ratingsDeleted: ratingsResult.changes,
      episodesDeleted: episodesResult.changes,
      podcastDeleted: podcastResult.changes
    });
  } catch (error) {
    console.error('Erro ao apagar podcast:', error);
    res.status(500).json({ error: 'Erro ao apagar podcast' });
  }
});

// Endpoint para recriar o podcast Velho amigo e carregar episódios do RSS
app.get('/recreate-velho-amigo', async (req, res) => {
  try {
    console.log('🔄 Recriando podcast Velho amigo e carregando episódios do RSS...');
    
    // Primeiro, criar o podcast se não existir
    const podcastData = {
      nome: "Velho amigo",
      link: "https://anchor.fm/s/f05045d8/podcast/rss",
      dia: "quarta",
      img: "/img/VelhoAmigo.png",
      plataforma: "spotify",
      rss: "https://anchor.fm/s/f05045d8/podcast/rss"
    };
    
    // Verificar se já existe
    const existingPodcast = db.prepare(`SELECT * FROM podcasts WHERE nome = ?`).get(podcastData.nome);
    
    let podcastId;
    if (existingPodcast) {
      podcastId = existingPodcast.id;
      console.log(`✅ Podcast ${podcastData.nome} já existe com ID: ${podcastId}`);
    } else {
      // Criar novo podcast
      const insertPodcast = db.prepare(`
        INSERT INTO podcasts (nome, link, dia_da_semana, img, plataforma, rss)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = insertPodcast.run(
        podcastData.nome,
        podcastData.link,
        podcastData.dia,
        podcastData.img,
        podcastData.plataforma,
        podcastData.rss
      );
      
      podcastId = result.lastInsertRowid.toString();
      console.log(`✅ Podcast ${podcastData.nome} criado com ID: ${podcastId}`);
    }
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    
    // Limpar episódios existentes
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(podcastId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos`);
    
    // Buscar episódios do RSS
    const episodes = await getAllRssEpisodes({ 
      id: podcastId, 
      nome: podcastData.nome, 
      rss: podcastData.rss,
      plataforma: podcastData.plataforma 
    });
    
    if (!episodes || episodes.length === 0) {
      db.prepare(`PRAGMA foreign_keys = ON`).run();
      return res.status(400).json({ error: 'Nenhum episódio encontrado no RSS' });
    }
    
    console.log(`📊 Total de episódios encontrados: ${episodes.length}`);
    
    // Inserir episódios na base de dados
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
      VALUES (?, ?, ?, ?)
    `);
    
    let addedCount = 0;
    console.log(`🔄 Inserindo ${episodes.length} episódios...`);
    
             for (let i = 0; i < episodes.length; i++) {
               const episode = episodes[i];
               console.log(`📝 Inserindo episódio ${i+1}/${episodes.length}: #${episode.episodeNum} - ${episode.title.substring(0, 50)}...`);
               
               // Debug: mostrar o tipo e valor do episodeNum
               console.log(`   🔍 DEBUG - episodeNum: "${episode.episodeNum}" (tipo: ${typeof episode.episodeNum})`);
               
               try {
                 const result = insertEpisode.run(
                   podcastId,
                   episode.episodeNum,
                   episode.title,
                   episode.pubDate.toISOString()
                 );
                 if (result.changes > 0) addedCount++;
                 console.log(`   ✅ Episódio #${episode.episodeNum} inserido com sucesso`);
               } catch (error) {
                 console.error(`   ❌ Erro ao inserir episódio #${episode.episodeNum}:`, error.message);
                 throw error;
               }
             }
    
    console.log(`✅ Adicionados ${addedCount} novos episódios para ${podcastData.nome}`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    
    res.json({
      success: true,
      message: `${podcastData.nome} recriado e carregado do RSS! Adicionados ${addedCount} episódios`,
      podcastId: podcastId,
      episodesAdded: addedCount,
      totalFound: episodes.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao recriar Velho amigo:', error);
    res.status(500).json({
      error: 'Erro ao recriar Velho amigo',
      message: error.message
    });
  }
});

// --- API: send notification ---
app.post('/api/notify', express.json(), (req, res) => {
  console.log('Received notification request:', req.body);
  const { targetUser, podcastName, rating, message, fromUser, podcastId } = req.body;

  // Log individual fields for debugging
  console.log('Field validation:');
  console.log('  targetUser:', targetUser, typeof targetUser);
  console.log('  podcastName:', podcastName, typeof podcastName);
  console.log('  rating:', rating, typeof rating);
  console.log('  message:', message, typeof message);
  console.log('  fromUser:', fromUser, typeof fromUser);
  console.log('  podcastId:', podcastId, typeof podcastId);

  if (!targetUser || !podcastName || !rating || !message || !fromUser) {
    console.error('Missing required fields in notification request');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Buscar número do episódio mais recente
    let episodeNumber = '';
    let episodeNum = null;
    if (podcastId) {
      const lastEp = db.prepare(`SELECT numero FROM episodios WHERE podcast_id = ? ORDER BY numero DESC LIMIT 1`).get(podcastId);
      if (lastEp && lastEp.numero) {
        episodeNumber = ` - Ep ${lastEp.numero}`;
        episodeNum = lastEp.numero;
      }
    }

    // Enviar notificação via WebSocket
    console.log('📝 Criando objeto notification com:');
    console.log('  targetUser:', targetUser);
    console.log('  podcastName:', podcastName);
    console.log('  episodeNumber:', episodeNumber);
    console.log('  rating:', rating);
    console.log('  message:', message);
    console.log('  fromUser:', fromUser);
    console.log('  episodeNum:', episodeNum);
    console.log('  podcastId:', podcastId);
    
    const notification = {
      targetUser,
      podcastName: `${podcastName}${episodeNumber}`,
      rating,
      message,
      fromUser,
      episodeNumber: episodeNum,
      podcastId,
      timestamp: new Date().toISOString()
    };
    
    console.log('📝 Objeto notification criado:', notification);
    
    const sent = sendNotificationToUser(targetUser, notification);
    
    // Enviar notificação push se disponível
    const pushSubscription = pushSubscriptions.get(targetUser);
    if (pushSubscription) {
      console.log(`Push subscription disponível para ${targetUser}`);
      
      // Criar payload para push notification com título personalizado
      const pushPayload = {
        title: `🎧 ${podcastName}${episodeNumber}`,
        body: `${fromUser} deu ${rating}/10: "${message}"`,
        icon: '/img/icon-192.svg',
        badge: '/img/badge-72.svg',
        data: {
          url: '/',
          podcastName,
          rating,
          message,
          fromUser,
          episodeNumber: episodeNum
        }
      };
      
      webpush.sendNotification(pushSubscription, JSON.stringify(pushPayload))
        .then(() => {
          console.log(`Push notification sent to ${targetUser}`);
        })
        .catch((error) => {
          console.error('Error sending push notification:', error);
          pushSubscriptions.delete(targetUser);
        });
    }
    
    console.log(`📱 NOTIFICATION for ${targetUser}:`);
    console.log(`   From: ${fromUser}`);
    console.log(`   Podcast: ${podcastName}`);
    console.log(`   Rating: ${rating}/10`);
    console.log(`   Message: "${message}"`);
    console.log(`   Sent via WebSocket: ${sent}`);
    console.log(`   Push subscription available: ${!!pushSubscription}`);
    
    res.json({ 
      success: true, 
      message: sent ? 'Notification sent successfully' : 'User not connected',
      notification: notification
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

// --- API: add podcast ---
// --- Endpoint para recarregar todos os podcasts ---
app.post('/reload-all-podcasts', async (req, res) => {
  try {
    console.log('🔄 Iniciando recarga de todos os podcasts...');
    
    // Get all podcasts
    const podcasts = db.prepare('SELECT * FROM podcasts').all();
    
    for (const podcast of podcasts) {
      console.log(`🔄 Recarregando ${podcast.nome}...`);
      
      // Clear existing episodes for this podcast
      db.prepare('DELETE FROM episodios WHERE podcast_id = ?').run(podcast.id);
      
      if (podcast.nome === 'watch.tm') {
        // Use watchtm.txt file
        await loadWatchTmFromFile(podcast.id);
      } else if (podcast.nome === 'Prata da Casa') {
        // Use pratadacasa.txt file
        await loadPrataDaCasaFromFile(podcast.id);
      } else {
        // Use appropriate function to get ALL episodes
        if (podcast.plataforma === "spotify" || podcast.plataforma === "soundcloud") {
          const episodes = await getAllRssEpisodes(podcast);
          if (episodes && episodes.length > 0) {
            console.log(`📅 Inserindo ${episodes.length} episódios para ${podcast.nome}...`);
            for (const episode of episodes) {
              try {
                db.prepare(`
                  INSERT INTO episodios (podcast_id, numero, titulo, data_publicacao, link)
                  VALUES (?, ?, ?, ?, ?)
                `).run(podcast.id, episode.episodeNum, episode.title, episode.pubDate.toISOString(), episode.link || '');
              } catch (err) {
                console.log(`   ⚠️ Erro ao inserir episódio ${episode.episodeNum}: ${err.message}`);
              }
            }
            console.log(`✅ ${podcast.nome} carregado: ${episodes.length} episódios`);
          }
        } else if (podcast.plataforma === "youtube") {
          const episodes = await getAllYoutubeEpisodes(podcast);
          if (episodes && episodes.length > 0) {
            console.log(`📅 Inserindo ${episodes.length} episódios para ${podcast.nome}...`);
            for (const episode of episodes) {
              try {
                db.prepare(`
                  INSERT INTO episodios (podcast_id, numero, titulo, data_publicacao, link)
                  VALUES (?, ?, ?, ?, ?)
                `).run(podcast.id, episode.episodeNum, episode.title, episode.pubDate.toISOString(), episode.link || '');
              } catch (err) {
                console.log(`   ⚠️ Erro ao inserir episódio ${episode.episodeNum}: ${err.message}`);
              }
            }
            console.log(`✅ ${podcast.nome} carregado: ${episodes.length} episódios`);
          }
        }
      }
    }
    
    console.log('✅ Todos os podcasts foram recarregados!');
    res.json({ success: true, message: 'Todos os podcasts foram recarregados com sucesso' });
  } catch (error) {
    console.error('❌ Erro ao recarregar podcasts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/podcast', upload.single('imagem'), async (req, res) => {
  console.log('Received add podcast request:', req.body);
  console.log('Uploaded file:', req.file);
  
  const { nome, link, dia_da_semana, plataforma, rss, channelId } = req.body;

  // Validation
  if (!nome || !link || !dia_da_semana) {
    return res.status(400).json({ 
      error: 'Missing required fields', 
      required: ['nome', 'link', 'dia_da_semana'] 
    });
  }

  // Check if image was uploaded
  if (!req.file) {
    return res.status(400).json({ 
      error: 'Image is required', 
      message: 'Por favor, faz upload de uma imagem para o podcast' 
    });
  }

  // Validate dia_da_semana
  const validDays = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  if (!validDays.includes(dia_da_semana)) {
    return res.status(400).json({ 
      error: 'Invalid dia_da_semana', 
      valid: validDays 
    });
  }

  // Validate plataforma and required fields
  const validPlatforms = ['Spotify', 'YouTube'];
  if (!validPlatforms.includes(plataforma)) {
    return res.status(400).json({ 
      error: 'Invalid plataforma', 
      valid: validPlatforms 
    });
  }

  // Validate platform-specific fields
  if (plataforma === 'Spotify' && !rss) {
    return res.status(400).json({ 
      error: 'RSS feed is required for Spotify podcasts' 
    });
  }

  if (plataforma === 'YouTube' && !channelId) {
    return res.status(400).json({ 
      error: 'Channel ID is required for YouTube podcasts' 
    });
  }

  try {
    // Generate ID (same as default podcasts)
    const id = Buffer.from(nome).toString('base64url').slice(0, 20);
    
    // Check if podcast already exists
    const existing = db.prepare(`SELECT id FROM podcasts WHERE id = ?`).get(id);
    if (existing) {
      // Remove uploaded file if podcast already exists
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(409).json({ 
        error: 'Podcast already exists', 
        id: id 
      });
    }

    // Use the uploaded file name (without extension for database)
    const imagem = path.parse(req.file.filename).name;

    // Insert new podcast
    const insertPodcast = db.prepare(`
      INSERT INTO podcasts (id, nome, link, dia_da_semana, imagem, plataforma, rss, channelId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertPodcast.run(id, nome, link, dia_da_semana, imagem, plataforma || null, rss || null, channelId || null);
    
    console.log(`Podcast adicionado: ${nome} (ID: ${id})`);
    console.log(`Imagem guardada: ${req.file.filename}`);
    
    // Criar objeto podcast para carregar histórico
    const newPodcast = {
      id,
      nome,
      link,
      dia_da_semana,
      imagem,
      plataforma: plataforma || null,
      rss: rss || null,
      channelId: channelId || null
    };
    
    // Carregar histórico automaticamente para Spotify/SoundCloud/YouTube
    let historyResult = null;
    if (plataforma === 'spotify' || plataforma === 'soundcloud' || plataforma === 'youtube') {
      console.log(`🔄 Carregando histórico automaticamente para ${nome}...`);
      try {
        historyResult = await fillPodcastHistory(newPodcast);
        if (historyResult.success) {
          console.log(`✅ Histórico carregado: ${historyResult.addedCount} episódios adicionados de ${historyResult.totalFound} encontrados`);
        } else {
          console.log(`⚠️ Erro ao carregar histórico: ${historyResult.error}`);
        }
      } catch (error) {
        console.error(`❌ Erro ao carregar histórico para ${nome}:`, error.message);
        historyResult = { success: false, error: error.message };
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Podcast adicionado com sucesso',
      podcast: { 
        id, 
        nome, 
        link, 
        dia_da_semana, 
        imagem, 
        plataforma, 
        rss, 
        channelId,
        imageFile: req.file.filename
      },
      historyLoaded: historyResult ? historyResult.success : false,
      episodesAdded: historyResult ? historyResult.addedCount : 0,
      episodesFound: historyResult ? historyResult.totalFound : 0
    });
    
  } catch (error) {
    console.error('Error adding podcast:', error);
    
    // Remove uploaded file if there was an error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error removing uploaded file:', unlinkError);
      }
    }
    
    res.status(500).json({ error: 'Failed to add podcast' });
  }
});

// --- Endpoint manual de update ---
app.get('/update', async (req,res)=>{
  await updatePodcasts();
  res.send('Atualização concluída!');
});

// --- Endpoint para preencher todos os históricos ---
app.get('/fill-histories', async (req,res)=>{
  try {
    await fillAllPodcastHistories();
    res.json({ 
      success: true, 
      message: 'Históricos preenchidos com sucesso!',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao preencher históricos:', error);
    res.status(500).json({ 
      error: 'Erro ao preencher históricos', 
      message: error.message 
    });
  }
});

// --- Endpoint para verificar estatísticas dos episódios ---
app.get('/stats', (req,res)=>{
  try {
    const totalEpisodes = db.prepare(`SELECT COUNT(*) as count FROM episodios`).get();
    const episodesByPodcast = db.prepare(`
      SELECT p.nome, COUNT(e.id) as episode_count 
      FROM podcasts p 
      LEFT JOIN episodios e ON p.id = e.podcast_id 
      GROUP BY p.id, p.nome 
      ORDER BY episode_count DESC
    `).all();
    
    res.json({
      totalEpisodes: totalEpisodes.count,
      episodesByPodcast: episodesByPodcast,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
  }
});

// --- Função para limpar todos os ratings ---
function clearAllRatings() {
  console.log('🧹 Limpando todos os ratings...');
  const result = db.prepare(`DELETE FROM ratings`).run();
  console.log(`✅ ${result.changes} ratings removidos`);
  return result.changes;
}

// --- Função para limpar episódios duplicados e inválidos ---
function cleanEpisodes() {
  console.log('🧹 Limpando episódios duplicados e inválidos...');
  
  let totalRemoved = 0;
  
  // 1. Remover episódios com títulos inválidos
  const invalidTitles = [
    'Último episódio desconhecido',
    '',
    null,
    'undefined',
    'null'
  ];
  
  for (const title of invalidTitles) {
    const result = db.prepare(`DELETE FROM episodios WHERE titulo = ? OR titulo IS NULL`).run(title);
    totalRemoved += result.changes;
    if (result.changes > 0) {
      console.log(`   🗑️  Removidos ${result.changes} episódios com título: "${title}"`);
    }
  }
  
  // 2. Remover episódios duplicados (mesmo podcast_id + numero)
  const duplicates = db.prepare(`
    SELECT podcast_id, numero, COUNT(*) as count 
    FROM episodios 
    GROUP BY podcast_id, numero 
    HAVING COUNT(*) > 1
  `).all();
  
  for (const dup of duplicates) {
    // Manter apenas o mais recente (maior ID)
    const result = db.prepare(`
      DELETE FROM episodios 
      WHERE podcast_id = ? AND numero = ? 
      AND id NOT IN (
        SELECT MAX(id) FROM episodios 
        WHERE podcast_id = ? AND numero = ?
      )
    `).run(dup.podcast_id, dup.numero, dup.podcast_id, dup.numero);
    
    totalRemoved += result.changes;
    if (result.changes > 0) {
      console.log(`   🗑️  Removidos ${result.changes} episódios duplicados (Podcast ID: ${dup.podcast_id}, Ep: ${dup.numero})`);
    }
  }
  
  console.log(`✅ Total de episódios removidos: ${totalRemoved}`);
  return totalRemoved;
}

// --- Endpoint para limpeza completa ---
app.get('/cleanup', (req,res)=>{
  try {
    console.log('🚀 Iniciando limpeza completa...');
    
    const ratingsRemoved = clearAllRatings();
    const episodesRemoved = cleanEpisodes();
    
    res.json({
      success: true,
      message: 'Limpeza concluída com sucesso!',
      ratingsRemoved,
      episodesRemoved,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro na limpeza:', error);
    res.status(500).json({ 
      error: 'Erro na limpeza', 
      message: error.message 
    });
  }
});

// --- API: cleanup watch.tm specifically ---
app.get('/cleanup-watchtm', (req,res)=>{
  try {
    console.log('🚀 Limpando episódios do watch.tm...');
    
    // Remover todos os episódios do watch.tm
    const watchtmId = 'd2F0Y2gudG0';
    const result = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(watchtmId);
    
    console.log(`✅ Removidos ${result.changes} episódios do watch.tm`);
    
    res.json({
      success: true,
      message: `Episódios do watch.tm limpos! Removidos: ${result.changes}`,
      episodesRemoved: result.changes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro na limpeza do watch.tm:', error);
    res.status(500).json({
      error: 'Erro na limpeza do watch.tm',
      message: error.message
    });
  }
});

// --- API: reload watch.tm specifically ---
app.get('/reload-watchtm', async (req,res)=>{
  try {
    console.log('🚀 Recarregando watch.tm com parsing correto...');
    
    // Primeiro limpar episódios existentes
    const watchtmId = 'd2F0Y2gudG0';
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(watchtmId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do watch.tm`);
    
    // Buscar podcast watch.tm
    const podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(watchtmId);
    if (!podcast) {
      return res.status(404).json({ error: 'Podcast watch.tm não encontrado' });
    }
    
    // Buscar episódios com parsing correto
    const episodes = await getAllYoutubeEpisodes(podcast);
    
    if (episodes && episodes.length > 0) {
      console.log(`📥 Encontrados ${episodes.length} episódios válidos para watch.tm`);
      
      const insertEpisode = db.prepare(`
        INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
        VALUES (?, ?, ?, ?)
      `);
      
      let addedCount = 0;
      for (const episode of episodes) {
        const result = insertEpisode.run(
          podcast.id,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
      }
      
      console.log(`✅ Adicionados ${addedCount} novos episódios para watch.tm`);
      
      res.json({
        success: true,
        message: `Watch.tm recarregado! Adicionados ${addedCount} episódios válidos`,
        episodesAdded: addedCount,
        totalFound: episodes.length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`⚠️  Nenhum episódio válido encontrado para watch.tm`);
      res.json({
        success: true,
        message: 'Nenhum episódio válido encontrado para watch.tm',
        episodesAdded: 0,
        totalFound: 0,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Erro ao recarregar watch.tm:', error);
    res.status(500).json({
      error: 'Erro ao recarregar watch.tm',
      message: error.message
    });
  }
});

// --- API: reload Zé Carioca specifically ---
app.get('/reload-zecarioca', async (req,res)=>{
  try {
    console.log('🚀 Recarregando Zé Carioca com RSS...');
    
    // Primeiro limpar episódios existentes
    const zecariocaId = 'WsOpIENhcmlvY2E';
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(zecariocaId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do Zé Carioca`);
    
    // Buscar podcast Zé Carioca
    const podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(zecariocaId);
    if (!podcast) {
      return res.status(404).json({ error: 'Podcast Zé Carioca não encontrado' });
    }
    
    // Buscar episódios com parsing específico
    const episodes = await getAllRssEpisodes(podcast);
    
    if (episodes && episodes.length > 0) {
      console.log(`📥 Encontrados ${episodes.length} episódios para Zé Carioca`);
      
      const insertEpisode = db.prepare(`
        INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
        VALUES (?, ?, ?, ?)
      `);
      
      let addedCount = 0;
      for (const episode of episodes) {
        const result = insertEpisode.run(
          podcast.id,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
      }
      
      console.log(`✅ Adicionados ${addedCount} novos episódios para Zé Carioca`);
      
      res.json({
        success: true,
        message: `Zé Carioca recarregado! Adicionados ${addedCount} episódios`,
        episodesAdded: addedCount,
        totalFound: episodes.length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`⚠️  Nenhum episódio encontrado para Zé Carioca`);
      res.json({
        success: true,
        message: 'Nenhum episódio encontrado para Zé Carioca',
        episodesAdded: 0,
        totalFound: 0,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Erro ao recarregar Zé Carioca:', error);
    res.status(500).json({
      error: 'Erro ao recarregar Zé Carioca',
      message: error.message
    });
  }
});

// --- API: reload Prata da Casa specifically ---
app.get('/reload-pratadacasa', async (req,res)=>{
  try {
    console.log('🚀 Recarregando Prata da Casa com RSS...');
    
    // Primeiro limpar episódios existentes
    const pratadacasaId = 'UHJhdGEgZGEgQ2FzYQ'; // Base64 for "Prata da Casa"
    
    // Verificar se o podcast existe, se não existir, criar
    let podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(pratadacasaId);
    if (!podcast) {
      // Criar o podcast se não existir
      const insertPodcast = db.prepare(`
        INSERT INTO podcasts (id, nome, link, dia_da_semana, imagem, plataforma, rss)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertPodcast.run(
        pratadacasaId,
        'Prata da Casa',
        'https://anchor.fm/s/1056d2710/podcast/rss',
        'quarta',
        '/img/PrataDaCasa.png',
        'spotify',
        'https://anchor.fm/s/1056d2710/podcast/rss'
      );
      podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(pratadacasaId);
    }
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(pratadacasaId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do Prata da Casa`);
    
    // Buscar episódios com parsing específico
    const episodes = await getAllRssEpisodes(podcast);
    
    if (episodes && episodes.length > 0) {
      console.log(`📥 Encontrados ${episodes.length} episódios para Prata da Casa`);
      
      const insertEpisode = db.prepare(`
        INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
        VALUES (?, ?, ?, ?)
      `);
      
      let addedCount = 0;
      for (const episode of episodes) {
        const result = insertEpisode.run(
          podcast.id,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
      }
      
      console.log(`✅ Adicionados ${addedCount} novos episódios para Prata da Casa`);
      
      res.json({
        success: true,
        message: `Prata da Casa recarregado! Adicionados ${addedCount} episódios`,
        episodesAdded: addedCount,
        totalFound: episodes.length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log(`⚠️  Nenhum episódio encontrado para Prata da Casa`);
      res.json({
        success: true,
        message: 'Nenhum episódio encontrado para Prata da Casa',
        episodesAdded: 0,
        totalFound: 0,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Erro ao recarregar Prata da Casa:', error);
    res.status(500).json({
      error: 'Erro ao recarregar Prata da Casa',
      message: error.message
    });
  }
});

// --- API: load Velho amigo from RSS file ---
app.get('/load-velhoamigo-from-file', async (req,res)=>{
  try {
    console.log('🚀 Carregando Velho amigo do ficheiro rss.txt...');
    
    // Verificar se o podcast existe
    const velhoamigoId = 'VmVsdG8gYW1pZ28'; // Base64 for "Velho amigo"
    let podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(velhoamigoId);
    
    if (!podcast) {
      console.log('❌ Podcast Velho amigo não encontrado na base de dados, criando...');
      // Criar o podcast se não existir
      const insertPodcast = db.prepare(`
        INSERT INTO podcasts (id, nome, link, dia_da_semana, imagem, plataforma, rss)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertPodcast.run(
        velhoamigoId,
        'Velho amigo',
        'https://anchor.fm/s/f05045d8/podcast/rss',
        'quarta',
        '/img/VelhoAmigo.png',
        'spotify',
        'https://anchor.fm/s/f05045d8/podcast/rss'
      );
      podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(velhoamigoId);
      console.log('✅ Podcast Velho amigo criado com sucesso');
    }
    
    console.log(`✅ Podcast encontrado: ${podcast.nome} (ID: ${podcast.id})`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Primeiro limpar episódios existentes
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(velhoamigoId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do Velho amigo`);
    
    // Ler ficheiro RSS
    const rssFilePath = path.join(__dirname, 'data', 'velhoamigo.txt');
    if (!fs.existsSync(rssFilePath)) {
      return res.status(404).json({ error: 'Ficheiro velhoamigo.txt não encontrado na pasta data' });
    }
    
    const rssContent = fs.readFileSync(rssFilePath, 'utf8');
    const data = await parseStringPromise(rssContent);
    const items = data.rss.channel[0].item;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Nenhum episódio encontrado no ficheiro RSS' });
    }
    
    console.log(`📊 Total de itens no ficheiro RSS: ${items.length}`);
    
    // Parsing específico para Velho amigo
    const episodes = items.map((item, index) => {
      const title = item.title[0];
      const pubDate = new Date(item.pubDate[0]);
      
      // Extrair número do episódio - dois formatos possíveis:
      // 1. "título | velho amigo #XX" (episódios recentes)
      // 2. "título | #0.X" (episódios antigos)
      
      const velhoAmigoPattern = /^(.+?)\s*\|\s*velho amigo #(\d{1,4})$/i;
      const match = title.match(velhoAmigoPattern);
      
      if (match) {
        const episodeNum = parseInt(match[2], 10);
        const episodeTitle = match[1].trim();
        console.log(`   ✅ Episódio válido (formato novo): #${episodeNum} - ${episodeTitle.substring(0, 50)}...`);
        return { episodeNum, title: episodeTitle, pubDate };
      } else {
        // Tentar formato antigo: "título | #0.X"
        const oldPattern = /^(.+?)\s*\|\s*#0\.(\d{1,2})$/i;
        const oldMatch = title.match(oldPattern);
        
        if (oldMatch) {
          const episodeNum = parseInt(oldMatch[2], 10);
          const episodeTitle = oldMatch[1].trim();
          console.log(`   ✅ Episódio válido (formato antigo): #${episodeNum} - ${episodeTitle.substring(0, 50)}...`);
          return { episodeNum, title: episodeTitle, pubDate };
        } else {
          console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
          // Se não seguir nenhum formato, usar índice
          return { episodeNum: items.length - index, title, pubDate };
        }
      }
    });
    
    // Filtrar episódios válidos
    const validEpisodes = episodes.filter(ep => ep.title && ep.title.trim() !== '');
    
    // Agrupar por data e manter apenas o mais recente por data
    const episodesByDate = {};
    validEpisodes.forEach(episode => {
      const dateKey = episode.pubDate.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!episodesByDate[dateKey] || episode.pubDate > episodesByDate[dateKey].pubDate) {
        episodesByDate[dateKey] = episode;
      }
    });
    
    // Converter de volta para array e ordenar por número do episódio
    const uniqueEpisodes = Object.values(episodesByDate);
    const sortedEpisodes = uniqueEpisodes.sort((a, b) => a.episodeNum - b.episodeNum);
    
    console.log(`📅 Episódios únicos por data: ${uniqueEpisodes.length} (removidos ${validEpisodes.length - uniqueEpisodes.length} duplicados por data)`);
    
    console.log(`👴 Total de episódios Velho amigo válidos: ${sortedEpisodes.length}`);
    
    // Inserir episódios na base de dados
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
      VALUES (?, ?, ?, ?)
    `);
    
    let addedCount = 0;
    console.log(`🔄 Tentando inserir ${sortedEpisodes.length} episódios...`);
    
    for (let i = 0; i < sortedEpisodes.length; i++) {
      const episode = sortedEpisodes[i];
      console.log(`📝 Inserindo episódio ${i+1}/${sortedEpisodes.length}: #${episode.episodeNum} - ${episode.title.substring(0, 50)}...`);
      
      try {
        const result = insertEpisode.run(
          velhoamigoId,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
        console.log(`   ✅ Episódio #${episode.episodeNum} inserido com sucesso`);
      } catch (error) {
        console.error(`   ❌ Erro ao inserir episódio #${episode.episodeNum}:`, error.message);
        throw error; // Re-throw para parar o processo
      }
    }
    
    console.log(`✅ Adicionados ${addedCount} novos episódios para Velho amigo`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    res.json({
      success: true,
      message: `Velho amigo carregado do ficheiro! Adicionados ${addedCount} episódios`,
      episodesAdded: addedCount,
      totalFound: sortedEpisodes.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao carregar Velho amigo do ficheiro:', error);
    res.status(500).json({
      error: 'Erro ao carregar Velho amigo do ficheiro',
      message: error.message
    });
  }
});

// --- API: clean episodes for specific podcast ---
app.get('/clean-podcast-episodes/:podcastId', async (req,res)=>{
  try {
    const podcastId = req.params.podcastId;
    console.log(`🧹 Limpando episódios do podcast ${podcastId}...`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    
    // Limpar episódios existentes
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(podcastId);
    console.log(`🗑️ Removidos ${deleteResult.changes} episódios do podcast ${podcastId}`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    
    res.json({
      success: true,
      message: `Episódios do podcast ${podcastId} limpos! Removidos ${deleteResult.changes} episódios`,
      episodesRemoved: deleteResult.changes,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`Erro ao limpar episódios do podcast ${req.params.podcastId}:`, error);
    res.status(500).json({
      error: `Erro ao limpar episódios do podcast ${req.params.podcastId}`,
      message: error.message
    });
  }
});

// --- API: clean Velho amigo duplicates ---
app.get('/clean-velhoamigo-duplicates', async (req,res)=>{
  try {
    console.log('🧹 Limpando duplicados do Velho amigo...');
    
    const velhoamigoId = 'VmVsdG8gYW1pZ28'; // Base64 for "Velho amigo"
    
    // Buscar todos os episódios do Velho amigo
    const episodes = db.prepare(`
      SELECT id, numero, titulo, data_publicacao 
      FROM episodios 
      WHERE podcast_id = ? 
      ORDER BY data_publicacao DESC
    `).all(velhoamigoId);
    
    console.log(`📊 Total de episódios encontrados: ${episodes.length}`);
    
    // Agrupar por título (case insensitive)
    const titleGroups = {};
    episodes.forEach(episode => {
      const titleKey = episode.titulo.toLowerCase().trim();
      if (!titleGroups[titleKey]) {
        titleGroups[titleKey] = [];
      }
      titleGroups[titleKey].push(episode);
    });
    
    console.log(`📋 Títulos únicos encontrados: ${Object.keys(titleGroups).length}`);
    
    // Identificar duplicados e manter apenas o mais recente
    const duplicatesToRemove = [];
    let duplicatesFound = 0;
    
    Object.values(titleGroups).forEach(group => {
      if (group.length > 1) {
        duplicatesFound += group.length - 1;
        // Manter o primeiro (mais recente) e marcar os outros para remoção
        const toKeep = group[0];
        const toRemove = group.slice(1);
        
        console.log(`🔄 Título duplicado: "${toKeep.titulo}"`);
        console.log(`   ✅ Manter: #${toKeep.numero} (${toKeep.data_publicacao})`);
        
        toRemove.forEach(episode => {
          console.log(`   ❌ Remover: #${episode.numero} (${episode.data_publicacao})`);
          duplicatesToRemove.push(episode.id);
        });
      }
    });
    
    console.log(`🔍 Duplicados encontrados: ${duplicatesFound}`);
    
    if (duplicatesToRemove.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum duplicado encontrado no Velho amigo',
        duplicatesRemoved: 0,
        totalEpisodes: episodes.length,
        uniqueTitles: Object.keys(titleGroups).length
      });
    }
    
    // Remover duplicados
    const deleteStmt = db.prepare(`DELETE FROM episodios WHERE id = ?`);
    let removedCount = 0;
    
    for (const episodeId of duplicatesToRemove) {
      try {
        const result = deleteStmt.run(episodeId);
        if (result.changes > 0) {
          removedCount++;
        }
      } catch (error) {
        console.error(`❌ Erro ao remover episódio ${episodeId}:`, error.message);
      }
    }
    
    console.log(`✅ Removidos ${removedCount} episódios duplicados`);
    
    res.json({
      success: true,
      message: `Velho amigo limpo! Removidos ${removedCount} duplicados`,
      duplicatesRemoved: removedCount,
      totalEpisodes: episodes.length,
      uniqueTitles: Object.keys(titleGroups).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao limpar duplicados do Velho amigo:', error);
    res.status(500).json({
      error: 'Erro ao limpar duplicados do Velho amigo',
      message: error.message
    });
  }
});

// --- API: clean episodes and reload ---
app.get('/reload-all-episodes', async (req,res)=>{
  try {
    console.log('🧹 Limpando TODOS os episódios e recarregando...');
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Deletar apenas episódios e ratings
    const deleteRatings = db.prepare(`DELETE FROM ratings`).run();
    const deleteEpisodes = db.prepare(`DELETE FROM episodios`).run();
    
    console.log(`🗑️ Removidos ${deleteRatings.changes} ratings`);
    console.log(`🗑️ Removidos ${deleteEpisodes.changes} episódios`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    // Recarregar todos os episódios
    console.log('🔄 Recarregando episódios de todos os podcasts...');
    await updatePodcasts();
    
    res.json({
      success: true,
      message: `Episódios limpos e recarregados! Removidos ${deleteRatings.changes} ratings e ${deleteEpisodes.changes} episódios`,
      removed: {
        ratings: deleteRatings.changes,
        episodes: deleteEpisodes.changes
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao recarregar episódios:', error);
    res.status(500).json({
      error: 'Erro ao recarregar episódios',
      message: error.message
    });
  }
});

// --- API: update RSS feeds in database ---
app.get('/update-rss-feeds', async (req,res)=>{
  try {
    console.log('🔄 Atualizando RSS feeds na base de dados...');
    
    const podcasts = [
      { nome: "watch.tm", rss: "https://anchor.fm/s/df67421c/podcast/rss" },
      { nome: "à noite mata", rss: "https://anchor.fm/s/db97b450/podcast/rss" },
      { nome: "desnorte", rss: "https://feeds.soundcloud.com/users/soundcloud:users:795862234/sounds.rss" },
      { nome: "Zé Carioca", rss: "https://anchor.fm/s/ea5b58fc/podcast/rss" },
      { nome: "Cubinho", rss: "https://anchor.fm/s/8e11a8d0/podcast/rss" },
      { nome: "Prata da Casa", rss: "https://anchor.fm/s/1056d2710/podcast/rss" },
      { nome: "Contraluz", rss: "https://anchor.fm/s/fb86963c/podcast/rss" },
      { nome: "Trocadilho", rss: "https://anchor.fm/s/3d61c0b4/podcast/rss" }
    ];
    
    const updateRss = db.prepare(`UPDATE podcasts SET rss = ? WHERE nome = ?`);
    let updatedCount = 0;
    
    for (const podcast of podcasts) {
      const result = updateRss.run(podcast.rss, podcast.nome);
      if (result.changes > 0) {
        console.log(`✅ RSS atualizado para ${podcast.nome}: ${podcast.rss}`);
        updatedCount++;
      } else {
        console.log(`⚠️ Podcast ${podcast.nome} não encontrado na base de dados`);
      }
    }
    
    res.json({
      success: true,
      message: `RSS feeds atualizados! ${updatedCount} podcasts atualizados`,
      updated: updatedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao atualizar RSS feeds:', error);
    res.status(500).json({
      error: 'Erro ao atualizar RSS feeds',
      message: error.message
    });
  }
});

// --- API: load all episodes from RSS for specific podcast ---
app.get('/load-all-episodes/:podcastName', async (req,res)=>{
  try {
    const podcastName = req.params.podcastName;
    console.log(`🚀 Carregando TODOS os episódios de ${podcastName} do RSS...`);
    
    // Buscar o podcast na base de dados
    const podcast = db.prepare(`SELECT * FROM podcasts WHERE nome = ?`).get(podcastName);
    
    if (!podcast) {
      return res.status(404).json({ error: `Podcast ${podcastName} não encontrado na base de dados` });
    }
    
    if (!podcast.rss) {
      return res.status(400).json({ error: `Podcast ${podcastName} não tem RSS feed configurado` });
    }
    
    console.log(`✅ Podcast encontrado: ${podcast.nome} (RSS: ${podcast.rss})`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Limpar episódios existentes
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(podcast.id);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos de ${podcastName}`);
    
    // Buscar episódios do RSS
    let episodes = [];
    
    if (podcast.plataforma === "spotify" || podcast.plataforma === "soundcloud") {
      episodes = await getAllRssEpisodes(podcast);
    } else if (podcast.plataforma === "youtube") {
      episodes = await getAllYoutubeEpisodes(podcast);
    }
    
    if (!episodes || episodes.length === 0) {
      db.prepare(`PRAGMA foreign_keys = ON`).run();
      return res.status(400).json({ error: `Nenhum episódio encontrado para ${podcastName}` });
    }
    
    console.log(`📊 Total de episódios encontrados: ${episodes.length}`);
    
    // Inserir episódios na base de dados
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
      VALUES (?, ?, ?, ?)
    `);
    
    let addedCount = 0;
    console.log(`🔄 Inserindo ${episodes.length} episódios...`);
    
    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      console.log(`📝 Inserindo episódio ${i+1}/${episodes.length}: #${episode.episodeNum} - ${episode.title.substring(0, 50)}...`);
      
      try {
        const result = insertEpisode.run(
          podcast.id,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
        console.log(`   ✅ Episódio #${episode.episodeNum} inserido com sucesso`);
      } catch (error) {
        console.error(`   ❌ Erro ao inserir episódio #${episode.episodeNum}:`, error.message);
        throw error;
      }
    }
    
    console.log(`✅ Adicionados ${addedCount} novos episódios para ${podcastName}`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    res.json({
      success: true,
      message: `${podcastName} carregado do RSS! Adicionados ${addedCount} episódios`,
      episodesAdded: addedCount,
      totalFound: episodes.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`Erro ao carregar episódios de ${req.params.podcastName}:`, error);
    res.status(500).json({
      error: `Erro ao carregar episódios de ${req.params.podcastName}`,
      message: error.message
    });
  }
});

// --- API: force remove Velho amigo duplicates ---
app.get('/force-remove-velho-amigo-duplicates', async (req,res)=>{
  try {
    console.log('🔧 Removendo FORÇADAMENTE duplicados do Velho amigo...');
    
    // Buscar todos os podcasts "Velho amigo"
    const velhoAmigoPodcasts = db.prepare(`
      SELECT id, nome, plataforma, link, dia_da_semana 
      FROM podcasts 
      WHERE nome = 'Velho amigo'
    `).all();
    
    console.log(`📊 Encontrados ${velhoAmigoPodcasts.length} podcasts "Velho amigo"`);
    
    if (velhoAmigoPodcasts.length <= 1) {
      return res.json({
        success: true,
        message: 'Nenhum duplicado encontrado no Velho amigo',
        found: velhoAmigoPodcasts.length
      });
    }
    
    // Encontrar o que tem plataforma = 'spotify' e link correto
    const spotifyVelhoAmigo = velhoAmigoPodcasts.find(p => 
      p.plataforma === 'spotify' && 
      p.link.includes('anchor.fm')
    );
    
    const others = velhoAmigoPodcasts.filter(p => 
      !(p.plataforma === 'spotify' && p.link.includes('anchor.fm'))
    );
    
    if (!spotifyVelhoAmigo) {
      return res.json({
        success: false,
        message: 'Nenhum Velho amigo com plataforma Spotify e link correto encontrado',
        found: velhoAmigoPodcasts.length
      });
    }
    
    console.log(`✅ Mantendo: ${spotifyVelhoAmigo.id} (${spotifyVelhoAmigo.plataforma})`);
    console.log(`❌ Removendo: ${others.length} duplicados`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    
    // Remover episódios e ratings dos duplicados
    let removedEpisodes = 0;
    let removedRatings = 0;
    
    for (const duplicate of others) {
      const deleteRatings = db.prepare(`DELETE FROM ratings WHERE podcast_id = ?`).run(duplicate.id);
      const deleteEpisodes = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(duplicate.id);
      const deletePodcast = db.prepare(`DELETE FROM podcasts WHERE id = ?`).run(duplicate.id);
      
      removedRatings += deleteRatings.changes;
      removedEpisodes += deleteEpisodes.changes;
      
      console.log(`🗑️ Removido podcast ${duplicate.id}: ${deleteEpisodes.changes} episódios, ${deleteRatings.changes} ratings`);
    }
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    
    res.json({
      success: true,
      message: `Duplicados do Velho amigo removidos FORÇADAMENTE! Mantido: ${spotifyVelhoAmigo.id}, Removidos: ${others.length} podcasts`,
      kept: spotifyVelhoAmigo.id,
      removed: {
        podcasts: others.length,
        episodes: removedEpisodes,
        ratings: removedRatings
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao remover duplicados do Velho amigo:', error);
    res.status(500).json({
      error: 'Erro ao remover duplicados do Velho amigo',
      message: error.message
    });
  }
});

// --- API: check for duplicate Velho amigo ---
app.get('/check-velho-amigo-duplicates', async (req,res)=>{
  try {
    // Verificar na base de dados
    const dbPodcasts = db.prepare(`
      SELECT id, nome, plataforma, link, dia_da_semana 
      FROM podcasts 
      WHERE nome = 'Velho amigo'
    `).all();
    
    // Verificar na lista de podcasts do código
    const codePodcasts = [
      { nome: "Velho amigo", link: "https://anchor.fm/s/f05045d8/podcast/rss", dia: "quarta", img: "/img/VelhoAmigo.png", plataforma:"spotify", rss:"https://anchor.fm/s/f05045d8/podcast/rss" }
    ];
    
    res.json({
      success: true,
      database: {
        count: dbPodcasts.length,
        podcasts: dbPodcasts
      },
      code: {
        count: codePodcasts.length,
        podcasts: codePodcasts
      },
      hasDuplicates: dbPodcasts.length > 1
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao verificar duplicados do Velho amigo',
      message: error.message
    });
  }
});

// --- API: list all podcasts ---
app.get('/list-all-podcasts', async (req,res)=>{
  try {
    const allPodcasts = db.prepare(`
      SELECT id, nome, plataforma, link, dia_da_semana 
      FROM podcasts 
      ORDER BY nome
    `).all();
    
    res.json({
      success: true,
      podcasts: allPodcasts,
      count: allPodcasts.length
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao listar todos os podcasts',
      message: error.message
    });
  }
});

// --- API: list all Velho amigo podcasts ---
app.get('/list-velho-amigo-podcasts', async (req,res)=>{
  try {
    const velhoAmigoPodcasts = db.prepare(`
      SELECT id, nome, plataforma, link, dia_da_semana 
      FROM podcasts 
      WHERE nome = 'Velho amigo'
    `).all();
    
    res.json({
      success: true,
      podcasts: velhoAmigoPodcasts,
      count: velhoAmigoPodcasts.length
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao listar podcasts Velho amigo',
      message: error.message
    });
  }
});

// --- API: remove duplicate Velho amigo ---
app.get('/fix-velho-amigo-duplicates', async (req,res)=>{
  try {
    console.log('🔧 Removendo duplicados do Velho amigo...');
    
    // Buscar todos os podcasts "Velho amigo"
    const velhoAmigoPodcasts = db.prepare(`
      SELECT id, nome, plataforma 
      FROM podcasts 
      WHERE nome = 'Velho amigo'
    `).all();
    
    console.log(`📊 Encontrados ${velhoAmigoPodcasts.length} podcasts "Velho amigo"`);
    
    if (velhoAmigoPodcasts.length <= 1) {
      return res.json({
        success: true,
        message: 'Nenhum duplicado encontrado no Velho amigo',
        found: velhoAmigoPodcasts.length
      });
    }
    
    // Encontrar o que tem plataforma = 'spotify'
    const spotifyVelhoAmigo = velhoAmigoPodcasts.find(p => p.plataforma === 'spotify');
    const others = velhoAmigoPodcasts.filter(p => p.plataforma !== 'spotify');
    
    if (!spotifyVelhoAmigo) {
      return res.json({
        success: false,
        message: 'Nenhum Velho amigo com plataforma Spotify encontrado',
        found: velhoAmigoPodcasts.length
      });
    }
    
    console.log(`✅ Mantendo: ${spotifyVelhoAmigo.id} (${spotifyVelhoAmigo.plataforma})`);
    console.log(`❌ Removendo: ${others.length} duplicados`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    
    // Remover episódios e ratings dos duplicados
    let removedEpisodes = 0;
    let removedRatings = 0;
    
    for (const duplicate of others) {
      const deleteRatings = db.prepare(`DELETE FROM ratings WHERE podcast_id = ?`).run(duplicate.id);
      const deleteEpisodes = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(duplicate.id);
      const deletePodcast = db.prepare(`DELETE FROM podcasts WHERE id = ?`).run(duplicate.id);
      
      removedRatings += deleteRatings.changes;
      removedEpisodes += deleteEpisodes.changes;
      
      console.log(`🗑️ Removido podcast ${duplicate.id}: ${deleteEpisodes.changes} episódios, ${deleteRatings.changes} ratings`);
    }
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    
    res.json({
      success: true,
      message: `Duplicados do Velho amigo removidos! Mantido: ${spotifyVelhoAmigo.id}, Removidos: ${others.length} podcasts`,
      kept: spotifyVelhoAmigo.id,
      removed: {
        podcasts: others.length,
        episodes: removedEpisodes,
        ratings: removedRatings
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao remover duplicados do Velho amigo:', error);
    res.status(500).json({
      error: 'Erro ao remover duplicados do Velho amigo',
      message: error.message
    });
  }
});

// --- API: clean entire database ---
app.get('/clean-database', async (req,res)=>{
  try {
    console.log('🧹 Limpando TODA a base de dados...');
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Deletar TODOS os dados
    const deleteRatings = db.prepare(`DELETE FROM ratings`).run();
    const deleteEpisodes = db.prepare(`DELETE FROM episodios`).run();
    const deletePodcasts = db.prepare(`DELETE FROM podcasts`).run();
    const deleteSubscriptions = db.prepare(`DELETE FROM push_subscriptions`).run();
    
    console.log(`🗑️ Removidos ${deleteRatings.changes} ratings`);
    console.log(`🗑️ Removidos ${deleteEpisodes.changes} episódios`);
    console.log(`🗑️ Removidos ${deletePodcasts.changes} podcasts`);
    console.log(`🗑️ Removidos ${deleteSubscriptions.changes} subscrições`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    res.json({
      success: true,
      message: `Base de dados limpa! Removidos ${deleteRatings.changes + deleteEpisodes.changes + deletePodcasts.changes + deleteSubscriptions.changes} registos`,
      removed: {
        ratings: deleteRatings.changes,
        episodes: deleteEpisodes.changes,
        podcasts: deletePodcasts.changes,
        subscriptions: deleteSubscriptions.changes
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao limpar base de dados:', error);
    res.status(500).json({
      error: 'Erro ao limpar base de dados',
      message: error.message
    });
  }
});

// --- API: clean Velho amigo episodes ---
app.get('/clean-velhoamigo-episodes', async (req,res)=>{
  try {
    console.log('🧹 Limpando TODOS os episódios do Velho amigo...');
    
    const velhoamigoId = 'VmVsdG8gYW1pZ28'; // Base64 for "Velho amigo"
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Deletar TODOS os episódios do Velho amigo
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(velhoamigoId);
    console.log(`🗑️ Removidos ${deleteResult.changes} episódios do Velho amigo`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    res.json({
      success: true,
      message: `Velho amigo limpo! Removidos ${deleteResult.changes} episódios`,
      episodesRemoved: deleteResult.changes,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao limpar episódios do Velho amigo:', error);
    res.status(500).json({
      error: 'Erro ao limpar episódios do Velho amigo',
      message: error.message
    });
  }
});

// --- API: debug Velho amigo episodes ---
app.get('/debug-velhoamigo-episodes', async (req,res)=>{
  try {
    const velhoamigoId = 'VmVsdG8gYW1pZ28'; // Base64 for "Velho amigo"
    
    const episodes = db.prepare(`
      SELECT numero, titulo, data_publicacao 
      FROM episodios 
      WHERE podcast_id = ? 
      ORDER BY numero ASC
      LIMIT 20
    `).all(velhoamigoId);
    
    res.json({
      success: true,
      episodes: episodes,
      total: episodes.length
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Erro ao buscar episódios do Velho amigo',
      message: error.message
    });
  }
});

// --- API: load Prata da Casa from RSS file ---
app.get('/load-pratadacasa-from-file', async (req,res)=>{
  try {
    console.log('🚀 Carregando Prata da Casa do ficheiro rss.txt...');
    
    // Verificar se o podcast existe
    const pratadacasaId = 'UHJhdGEgZGEgQ2FzYQ'; // Base64 for "Prata da Casa"
    let podcast = db.prepare(`SELECT * FROM podcasts WHERE id = ?`).get(pratadacasaId);
    
    if (!podcast) {
      console.log('❌ Podcast Prata da Casa não encontrado na base de dados');
      return res.status(404).json({ 
        error: 'Podcast Prata da Casa não encontrado',
        message: 'O podcast precisa existir na tabela podcasts primeiro'
      });
    }
    
    console.log(`✅ Podcast encontrado: ${podcast.nome} (ID: ${podcast.id})`);
    
    // Desativar foreign key checks temporariamente
    db.prepare(`PRAGMA foreign_keys = OFF`).run();
    console.log('🔓 Foreign key checks desativados temporariamente');
    
    // Primeiro limpar episódios existentes
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(pratadacasaId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do Prata da Casa`);
    
    // Ler ficheiro RSS
    const rssFilePath = path.join(__dirname, 'data', 'pratadacasa.txt');
    if (!fs.existsSync(rssFilePath)) {
      return res.status(404).json({ error: 'Ficheiro pratadacasa.txt não encontrado na pasta data' });
    }
    
    const rssContent = fs.readFileSync(rssFilePath, 'utf8');
    const data = await parseStringPromise(rssContent);
    const items = data.rss.channel[0].item;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Nenhum episódio encontrado no ficheiro RSS' });
    }
    
    console.log(`📊 Total de itens no ficheiro RSS: ${items.length}`);
    
    // Parsing específico para Prata da Casa
    const episodes = items.map((item, index) => {
      const title = item.title[0];
      const pubDate = new Date(item.pubDate[0]);
      
      // Extrair número do episódio do formato "Prata da Casa #XX - Título" (com ou sem zeros à frente)
      const prataDaCasaPattern = /^Prata da Casa #(\d{1,4})\s*-\s*(.+)$/i;
      const match = title.match(prataDaCasaPattern);
      
      if (match) {
        const episodeNum = parseInt(match[1], 10); // parseInt remove zeros à frente automaticamente
        const episodeTitle = match[2].trim();
        console.log(`   ✅ Episódio válido: #${episodeNum} - ${episodeTitle.substring(0, 50)}...`);
        return { episodeNum, title: episodeTitle, pubDate };
      } else {
        console.log(`   ❌ Episódio ignorado (formato inválido): "${title}"`);
        // Se não seguir o formato específico, usar índice
        return { episodeNum: items.length - index, title, pubDate };
      }
    });
    
    // Filtrar episódios válidos e ordenar
    const validEpisodes = episodes.filter(ep => ep.title && ep.title.trim() !== '');
    const sortedEpisodes = validEpisodes.sort((a, b) => a.episodeNum - b.episodeNum);
    
    console.log(`💎 Total de episódios Prata da Casa válidos: ${sortedEpisodes.length}`);
    
    // Inserir episódios na base de dados
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
      VALUES (?, ?, ?, ?)
    `);
    
    let addedCount = 0;
    console.log(`🔄 Tentando inserir ${sortedEpisodes.length} episódios...`);
    
    for (let i = 0; i < sortedEpisodes.length; i++) {
      const episode = sortedEpisodes[i];
      console.log(`📝 Inserindo episódio ${i+1}/${sortedEpisodes.length}: #${episode.episodeNum} - ${episode.title.substring(0, 50)}...`);
      
      try {
        const result = insertEpisode.run(
          pratadacasaId,
          episode.episodeNum,
          episode.title,
          episode.pubDate.toISOString()
        );
        if (result.changes > 0) addedCount++;
        console.log(`   ✅ Episódio #${episode.episodeNum} inserido com sucesso`);
      } catch (error) {
        console.error(`   ❌ Erro ao inserir episódio #${episode.episodeNum}:`, error.message);
        throw error; // Re-throw para parar o processo
      }
    }
    
    console.log(`✅ Adicionados ${addedCount} novos episódios para Prata da Casa`);
    
    // Reativar foreign key checks
    db.prepare(`PRAGMA foreign_keys = ON`).run();
    console.log('🔒 Foreign key checks reativados');
    
    res.json({
      success: true,
      message: `Prata da Casa carregado do ficheiro! Adicionados ${addedCount} episódios`,
      episodesAdded: addedCount,
      totalFound: sortedEpisodes.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao carregar Prata da Casa do ficheiro:', error);
    res.status(500).json({
      error: 'Erro ao carregar Prata da Casa do ficheiro',
      message: error.message
    });
  }
});

// --- API: load watch.tm from RSS file ---
app.get('/load-watchtm-from-file', async (req,res)=>{
  try {
    console.log('🚀 Carregando watch.tm do ficheiro rss.txt...');
    
    // Primeiro limpar episódios existentes
    const watchtmId = 'd2F0Y2gudG0';
    const deleteResult = db.prepare(`DELETE FROM episodios WHERE podcast_id = ?`).run(watchtmId);
    console.log(`🧹 Removidos ${deleteResult.changes} episódios antigos do watch.tm`);
    
    // Ler ficheiro RSS
    const rssFilePath = path.join(__dirname, 'data', 'rss.txt');
    
    if (!fs.existsSync(rssFilePath)) {
      return res.status(404).json({ error: 'Ficheiro rss.txt não encontrado na pasta data' });
    }
    
    const rssContent = fs.readFileSync(rssFilePath, 'utf8');
    const data = await parseStringPromise(rssContent);
    const items = data.rss.channel[0].item;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Nenhum episódio encontrado no ficheiro RSS' });
    }
    
    console.log(`📊 Total de itens no ficheiro RSS: ${items.length}`);
    
    // Processar episódios
    const episodes = items.map((item, index) => {
      const title = item.title[0];
      const pubDate = new Date(item.pubDate[0]);
      
      // Extrair número do episódio do FIM do título (sempre no final)
      const match = title.match(/#(\d{1,4})$/);
      const episodeNum = match ? parseInt(match[1], 10) : (items.length - index);
      
      return { episodeNum, title, pubDate };
    });
    
    // Ordenar por número do episódio (crescente)
    const sortedEpisodes = episodes.sort((a, b) => a.episodeNum - b.episodeNum);
    
    // Inserir na base de dados
    const insertEpisode = db.prepare(`
      INSERT OR IGNORE INTO episodios (podcast_id, numero, titulo, data_publicacao)
      VALUES (?, ?, ?, ?)
    `);
    
    let addedCount = 0;
    for (const episode of sortedEpisodes) {
      const result = insertEpisode.run(
        watchtmId,
        episode.episodeNum,
        episode.title,
        episode.pubDate.toISOString()
      );
      if (result.changes > 0) addedCount++;
    }
    
    console.log(`✅ Adicionados ${addedCount} novos episódios para watch.tm`);
    
    res.json({
      success: true,
      message: `Watch.tm carregado do ficheiro! Adicionados ${addedCount} episódios`,
      episodesAdded: addedCount,
      totalFound: sortedEpisodes.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erro ao carregar watch.tm do ficheiro:', error);
    res.status(500).json({
      error: 'Erro ao carregar watch.tm do ficheiro',
      message: error.message
    });
  }
});


// For Vercel deployment
if (process.env.NODE_ENV === 'production') {
  // Export the app for Vercel
  module.exports = app;
} else {
  // Start server locally
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
    console.log('📡 Episódios serão verificados quando a página for aberta');
  });
}
