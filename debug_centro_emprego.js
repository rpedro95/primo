import express from "express";
import Database from "better-sqlite3";
import path from "path";

const __dirname = path.resolve();
const db = new Database(path.join(__dirname, 'database.db'));
const app = express();

// Endpoint para diagnosticar episódios do Centro de Emprego
app.get('/debug-centro-emprego', async (req, res) => {
  try {
    console.log('🔍 Diagnosticando Centro de Emprego...');
    
    // Buscar podcast
    const podcast = db.prepare('SELECT * FROM podcasts WHERE nome = ?').get(['Centro De Emprego']);
    
    if (!podcast) {
      return res.status(404).json({ error: 'Podcast Centro De Emprego não encontrado' });
    }
    
    console.log(`📋 Podcast encontrado: ID=${podcast.id}, Channel=${podcast.channelId}`);
    
    // Buscar todos os episódios
    const episodes = db.prepare('SELECT * FROM episodios WHERE podcast_id = ? ORDER BY numero DESC').all([podcast.id]);
    
    console.log(`📊 Total de episódios encontrados: ${episodes.length}`);
    
    // Analisar títulos para encontrar problemas
    const problematicEpisodes = episodes.filter(ep => {
      // Procurar números no título que possam confundir o parsing
      const titleNumbers = ep.titulo.match(/\d+/g);
      return titleNumbers && titleNumbers.some(num => parseInt(num) > 1000);
    });
    
    console.log(`⚠️ Episódios potencialmente problemáticos: ${problematicEpisodes.length}`);
    
    // Buscar último episódio
    const lastEpisode = episodes[0];
    
    res.json({
      success: true,
      podcast: {
        id: podcast.id,
        nome: podcast.nome,
        plataforma: podcast.plataforma,
        channelId: podcast.channelId
      },
      episodes: {
        total: episodes.length,
        last_episode: lastEpisode ? {
          numero: lastEpisode.numero,
          titulo: lastEpisode.titulo,
          data_publicacao: lastEpisode.data_publicacao
        } : null,
        problematic_episodes: problematicEpisodes.map(ep => ({
          numero: ep.numero,
          titulo: ep.titulo,
          title_numbers: ep.titulo.match(/\d+/g),
          data_publicacao: ep.data_publicacao
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Erro ao diagnosticar Centro de Emprego:', error);
    res.status(500).json({ error: 'Erro ao diagnosticar', message: error.message });
  }
});

// Endpoint para corrigir episódio específico
app.get('/fix-centro-episode/:wrongNumber/:correctNumber', async (req, res) => {
  try {
    const { wrongNumber, correctNumber } = req.params;
    
    console.log(`🔧 Corrigindo episódio #${wrongNumber} para #${correctNumber}...`);
    
    // Buscar podcast
    const podcast = db.prepare('SELECT * FROM podcasts WHERE nome = ?').get(['Centro De Emprego']);
    
    if (!podcast) {
      return res.status(404).json({ error: 'Podcast Centro De Emprego não encontrado' });
    }
    
    // Corrigir episódio
    const result = db.prepare('UPDATE episodios SET numero = ? WHERE podcast_id = ? AND numero = ?')
      .run([parseInt(correctNumber), podcast.id, parseInt(wrongNumber)]);
    
    if (result.changes > 0) {
      console.log(`✅ Episódio ${wrongNumber} corrigido para ${correctNumber}`);
      
      res.json({ 
        success: true, 
        message: `Episódio #${wrongNumber} corrigido para #${correctNumber}`,
        correction: { from: wrongNumber, to: correctNumber },
        changes: result.changes,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({ 
        success: false, 
        message: `Episódio #${wrongNumber} não encontrado para correção`,
        podcast: podcast.nome
      });
    }
  } catch (error) {
    console.error('❌ Erro ao corrigir episódio:', error);
    res.status(500).json({ 
      error: 'Erro ao corrigir episódio', 
      message: error.message 
    });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor de diagnóstico rodando em http://localhost:${PORT}`);
  console.log(`📊 Use: http://localhost:${PORT}/debug-centro-emprego`);
});
