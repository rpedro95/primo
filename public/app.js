async function api(path,opts){ const res=await fetch('/api'+path,opts||{}); return res.json(); }

function escapeHtml(s){ return String(s).replace(/[&<>"]+/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c)); }

async function load(){
  const p=await api('/podcasts'); const pods=p.podcasts||[];
  const podList=document.getElementById('podList'); podList.innerHTML='';
  for(const pod of pods){
    const el=document.createElement('div'); el.innerHTML=`<strong>${escapeHtml(pod.title)}</strong> — ${pod.feedUrl}`; podList.appendChild(el);
  }
}

document.getElementById('addPod').addEventListener('click',async()=>{
  const title=document.getElementById('newTitle').value.trim();
  const feed=document.getElementById('newFeed').value.trim();
  if(!title||!feed) return alert('Title & feed required');
  await api('/podcast',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,feedUrl:feed})});
  document.getElementById('newTitle').value=''; document.getElementById('newFeed').value='';
  load();
});

load();
