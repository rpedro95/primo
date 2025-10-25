import Database from "better-sqlite3";
import path from "path";

const __dirname = path.resolve();
const db = new Database(path.join(__dirname, 'database.db'));

// Listar todos os podcasts
const podcasts = db.prepare('SELECT * FROM podcasts ORDER BY nome').all();

console.log('📋 Todos os podcasts na base de dados:');
podcasts.forEach(p => {
  console.log(`  ID: ${p.id}, Nome: "${p.nome}", Plataforma: ${p.plataforma}`);
});

// Procurar por nomes similares
const centroPodcasts = podcasts.filter(p => 
  p.nome.toLowerCase().includes('centro') || 
  p.nome.toLowerCase().includes('emprego')
);

console.log('\n🔍 Podcasts com "centro" ou "emprego" no nome:');
centroPodcasts.forEach(p => {
  console.log(`  ID: ${p.id}, Nome: "${p.nome}"`);
});

db.close();
