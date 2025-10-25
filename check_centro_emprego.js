import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import RSSParser from "rss-parser";

// Configuração do Centro de Emprego
const CENTRO_EMPREGO_CONFIG = {
  name: "Centro De Emprego",
  channelId: "UCP7gzkiMz6wr_Yx1hfJ_0YA", // YouTube Channel ID
  rssUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP7gzkiMz6wr_Yx1hfJ_0YA"
};

// Função específica para extrair número do episódio do Centro de Emprego
// Procura no FINAL do título pelo padrão "#numero"
function extractCentroEmpregoEpisodeNumber(title) {
  console.log(`🔍 Analisando título: "${title}"`);
  
  // Procurar padrão "#numero" no final do título
  const hashMatch = title.match(/#(\d+)\s*$/);
  if (hashMatch) {
    const episodeNum = parseInt(hashMatch[1], 10);
    console.log(`✅ Número encontrado via # final: ${episodeNum}`);
    return episodeNum;
  }
  
  // Procurar padrão "Centro de Emprego #numero" no final
  const centroMatch = title.match(/Centro de Emprego\s+#(\d+)\s*$/);
  if (centroMatch) {
    const episodeNum = parseInt(centroMatch[1], 10);
    console.log(`✅ Número encontrado via "Centro de Emprego #": ${episodeNum}`);
    return episodeNum;
  }
  
  // Procurar qualquer número no final do título
  const endNumberMatch = title.match(/(\d+)\s*$/);
  if (endNumberMatch) {
    const episodeNum = parseInt(endNumberMatch[1], 10);
    console.log(`⚠️ Número encontrado no final (genérico): ${episodeNum}`);
    return episodeNum;
  }
  
  console.log(`❌ Nenhum número de episódio encontrado`);
  return null;
}

// Verificar episódios mais recentes do Centro de Emprego
async function checkCentroEmpregoNewEpisode() {
  try {
    console.log(`🔍 Verificando episódios novos do ${CENTRO_EMPREGO_CONFIG.name}...`);
    
    // Buscar RSS do YouTube
    const response = await fetch(CENTRO_EMPREGO_CONFIG.rssUrl);
    if (!response.ok) {
      throw new Error(`Erro ao buscar RSS: ${response.status}`);
    }
    
    const rssText = await response.text();
    const data = await parseStringPromise(rssText);
    
    const items = data.feed?.entry || [];
    console.log(`📊 Encontrados ${items.length} itens no RSS`);
    
    if (items.length === 0) {
      return {
        success: false,
        message: "Nenhum episódio encontrado no RSS"
      };
    }
    
    // Analisar os 3 episódios mais recentes
    const recentEpisodes = items.slice(0, 3).map((item, index) => {
      const title = item.title[0];
      const published = new Date(item.published[0]);
      const videoId = item['yt:videoId'][0];
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      const episodeNum = extractCentroEmpregoEpisodeNumber(title);
      
      return {
        position: index + 1,
        title,
        episodeNum,
        published,
        videoUrl,
        isThisWeek: isThisWeek(published)
      };
    });
    
    console.log(`\n📋 Episódios recentes:`);
    recentEpisodes.forEach(ep => {
      console.log(`  ${ep.position}. "${ep.title}"`);
      console.log(`     Episódio: ${ep.episodeNum || 'Não identificado'}`);
      console.log(`     Data: ${ep.published.toLocaleDateString('pt-PT')}`);
      console.log(`     Esta semana: ${ep.isThisWeek ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`     Link: ${ep.videoUrl}`);
      console.log('');
    });
    
    // Verificar se há episódio desta semana
    const thisWeekEpisode = recentEpisodes.find(ep => ep.isThisWeek && ep.episodeNum);
    
    return {
      success: true,
      podcast: CENTRO_EMPREGO_CONFIG.name,
      latest_episode: recentEpisodes[0],
      this_week_episode: thisWeekEpisode,
      all_recent: recentEpisodes,
      summary: {
        has_new_this_week: !!thisWeekEpisode,
        latest_episode_number: recentEpisodes[0].episodeNum,
        latest_title: recentEpisodes[0].title
      }
    };
    
  } catch (error) {
    console.error(`❌ Erro ao verificar ${CENTRO_EMPREGO_CONFIG.name}:`, error);
    return {
      success: false,
      error: error.message,
      podcast: CENTRO_EMPREGO_CONFIG.name
    };
  }
}

// Verificar se a data é desta semana (desde o último domingo)
function isThisWeek(date) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Segunda, etc.
  
  // Calcular o último domingo
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - dayOfWeek);
  lastSunday.setHours(0, 0, 0, 0);
  
  // Verificar se o episódio é depois do último domingo
  return date >= lastSunday;
}

// Endpoint para verificar via HTTP
import express from "express";
const app = express();

app.get('/check-centro-emprego', async (req, res) => {
  console.log('🌐 Endpoint chamado: /check-centro-emprego');
  const result = await checkCentroEmpregoNewEpisode();
  res.json(result);
});

app.get('/check-centro-emprego-episode/:title', async (req, res) => {
  const { title } = req.params;
  const episodeNum = extractCentroEmpregoEpisodeNumber(decodeURIComponent(title));
  
  res.json({
    title: decodeURIComponent(title),
    episode_number: episodeNum,
    success: episodeNum !== null
  });
});

// Iniciar servidor
const PORT = 3002;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de verificação do Centro de Emprego rodando em http://localhost:${PORT}`);
  console.log(`📊 Use: http://localhost:${PORT}/check-centro-emprego`);
  console.log(`🔍 Testar título: http://localhost:${PORT}/check-centro-emprego-episode/Título aqui`);
  
  // Verificar automaticamente ao iniciar
  console.log('\n' + '='.repeat(60));
  console.log('🔍 VERIFICAÇÃO AUTOMÁTICA AO INICIAR');
  console.log('='.repeat(60));
  checkCentroEmpregoNewEpisode().then(result => {
    console.log('\n📊 Resultado da verificação automática:');
    console.log(JSON.stringify(result, null, 2));
  });
});
