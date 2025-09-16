import Database from 'better-sqlite3';
import { parseStringPromise } from 'xml2js';

const db = new Database('database.db');

// Test RSS fetching for one podcast
const podcast = db.prepare('SELECT * FROM podcasts WHERE nome = ?').get('à noite mata');
console.log('Testing podcast:', podcast);

if (podcast && podcast.rss) {
  console.log('Fetching RSS from:', podcast.rss);
  
  try {
    const res = await fetch(podcast.rss);
    console.log('RSS Response status:', res.status);
    
    if (res.ok) {
      const xml = await res.text();
      console.log('RSS XML length:', xml.length);
      
      const data = await parseStringPromise(xml);
      const items = data.rss.channel[0].item;
      console.log('Number of items in RSS:', items ? items.length : 0);
      
      if (items && items.length > 0) {
        console.log('First few items:');
        items.slice(0, 3).forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.title[0]} - ${item.pubDate[0]}`);
        });
      }
    } else {
      console.log('RSS fetch failed:', res.status, res.statusText);
    }
  } catch (error) {
    console.error('Error fetching RSS:', error);
  }
} else {
  console.log('No podcast found or no RSS URL');
}

db.close();
