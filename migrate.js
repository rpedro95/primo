// list_episodios.js
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const __dirname = path.resolve();
const dbPath = path.join(__dirname, "data", "podcast_battle.db");

if (!fs.existsSync(dbPath)) {
  console.error("❌ Base de dados não encontrada!");
  process.exit(1);
}

const db = new Database(dbPath);

// Busca todos os registros da tabela episodios
const episodios = db.prepare(`SELECT * FROM episodios`).all();

if (episodios.length === 0) {
  console.log("Nenhum episódio encontrado.");
} else {
  console.log("📺 Episódios encontrados:");
  episodios.forEach(e => {
    console.log(`
ID: ${e.id}
Podcast ID: ${e.podcast_id}
Número: ${e.numero}
Título: ${e.titulo}
Data de Publicação: ${e.data_publicacao}
Rating Pedro: ${e.rating_pedro ?? "-"}
Rating João: ${e.rating_joao ?? "-"}
------------------------------
    `);
  });
}
