import fs from 'fs';
import xml2js from 'xml2js';

// Ler o ficheiro velhoamigo.txt
const xmlContent = fs.readFileSync('data/velhoamigo.txt', 'utf8');

// Parsear XML
const parser = new xml2js.Parser();
const result = await parser.parseStringPromise(xmlContent);
const items = result.rss.channel[0].item;

console.log('=== TESTE DE PARSING VELHO AMIGO ===');
console.log(`Total de itens encontrados: ${items.length}`);

// Procurar pelo episódio "O que define a amizade?"
const amizadeEpisode = items.find(item => 
  item.title[0].includes('amizade') || item.title[0].includes('0.95')
);

if (amizadeEpisode) {
  const title = amizadeEpisode.title[0];
  console.log(`\nEpisódio encontrado: "${title}"`);
  
  // Testar o regex
  const match = title.match(/\|\s*#(\d+(?:\.\d+)?)$/);
  console.log(`Match result:`, match);
  
  if (match) {
    const numberStr = match[1];
    console.log(`Number string: "${numberStr}"`);
    
    let episodeNum;
    if (numberStr.includes('.')) {
      episodeNum = numberStr;
    } else {
      episodeNum = parseInt(numberStr, 10);
    }
    
    console.log(`Final episode number: "${episodeNum}"`);
  }
} else {
  console.log('Episódio "amizade" não encontrado');
}

// Testar alguns episódios com números decimais
console.log('\n=== TESTANDO NÚMEROS DECIMAIS ===');
const decimalEpisodes = items.filter(item => 
  item.title[0].includes('#0.') || item.title[0].includes('#1.')
);

console.log(`Episódios com números decimais encontrados: ${decimalEpisodes.length}`);

decimalEpisodes.slice(0, 5).forEach((item, index) => {
  const title = item.title[0];
  const match = title.match(/\|\s*#(\d+(?:\.\d+)?)$/);
  console.log(`${index + 1}. "${title}"`);
  console.log(`   Match: ${match ? match[1] : 'NONE'}`);
});
