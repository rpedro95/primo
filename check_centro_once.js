import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";

// Configuração do Centro de Emprego
const CENTRO_EMPREGO_CONFIG = {
  name: "Centro De Emprego",
  channelId: "UCP7gzkiMz6wr_Yx1hfJ_0YA",
  rssUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCP7gzkiMz6wr_Yx1hfJ_0YA"
};

// Função específica para extrair número do episódio do Centro de Emprego
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

// Verificar se a data é desta semana (desde o último domingo)
function isThisWeek(date) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Segunda, etc.
  
  // Calcular o último domingo
  const lastSunday = new Date(now);
  lastSunday.setDate(now.getDate() - dayOfWeek);
  lastSunday.setHours(0, 0, 0, 0);
  
  return date >= lastSunday;
}

// Verificar episódios mais recentes
async function checkCentroEmpregoNewEpisode() {
  try {
    console.log(`🔍 Verificando episódios novos do ${CENTRO_EMPREGO_CONFIG.name}...`);
    console.log(`📡 RSS URL: ${CENTRO_EMPREGO_CONFIG.rssUrl}`);
    
    const response = await fetch(CENTRO_EMPREGO_CONFIG.rssUrl);
    if (!response.ok) {
      throw new Error(`Erro ao buscar RSS: ${response.status}`);
    }
    
    const rssText = await response.text();
    const data = await parseStringPromise(rssText);
    
    const items = data.feed?.entry || [];
    console.log(`📊 Encontrados ${items.length} itens no RSS`);
    
    if (items.length === 0) {
      return { success: false, message: "Nenhum episódio encontrado" };
    }
    
    // Analisar os 5 episódios mais recentes
    const recentEpisodes = items.slice(0, 5).map((item, index) => {
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
    
    console.log(`\n📋 EPISÓDIOS RECENTES DO CENTRO DE EMPREGO:`);
    console.log('='.repeat(80));
    
    recentEpisodes.forEach(ep => {
      console.log(`\n${ep.position}. 📺 "${ep.title}"`);
      console.log(`   🎞️ Episódio: ${ep.episodeNum || '❌ Não identificado'}`);
      console.log(`   📅 Data: ${ep.published.toLocaleDateString('pt-PT')} ${ep.published.toLocaleTimeString('pt-PT')}`);
      console.log(`   🗓️ Esta semana: ${ep.isThisWeek ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`   🔗 Link: ${ep.videoUrl}`);
    });
    
    // Verificar se há episódio desta semana
    const thisWeekEpisode = recentEpisodes.find(ep => ep.isThisWeek && ep.episodeNum);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RESUMO:');
    console.log('='.repeat(80));
    
    if (thisWeekEpisode) {
      console.log(`✅ EPISÓDIO DESTA SEMANA ENCONTRADO!`);
      console.log(`   🎞️ Episódio #${thisWeekEpisode.episodeNum}`);
      console.log(`   📺 Título: "${thisWeekEpisode.title}"`);
      console.log(`   📅 Publicado: ${thisWeekEpisode.published.toLocaleDateString('pt-PT')}`);
      console.log(`   🔗 Assistir: ${thisWeekEpisode.videoUrl}`);
    } else {
      console.log(`❌ Nenhum episódio novo desta semana encontrado`);
      console.log(`   📺 Último episódio: "${recentEpisodes[0].title}"`);
      console.log(`   🎞️ Número: ${recentEpisodes[0].episodeNum || 'Não identificado'}`);
      console.log(`   📅 Data: ${recentEpisodes[0].published.toLocaleDateString('pt-PT')}`);
    }
    
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

// Executar verificação
console.log('🚀 INICIANDO VERIFICAÇÃO DO CENTRO DE EMPREGO');
console.log('='.repeat(80));

checkCentroEmpregoNewEpisode().then(result => {
  console.log('\n✅ Verificação concluída!');
}).catch(error => {
  console.error('\n❌ Erro na verificação:', error);
});
