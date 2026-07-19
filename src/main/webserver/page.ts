/** Self-contained mobile companion page served over the LAN. No external assets. */
export const MOBILE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>NIHILPOINTZERO — Mobile</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0b0f1a; color: #e8eaf0; }
  header { padding: 16px; border-bottom: 1px solid #1c2333; }
  header b { color: #e8b923; letter-spacing: .15em; }
  .tabs { display: flex; gap: 6px; padding: 10px; position: sticky; top: 0; background: #0b0f1a; }
  .tabs button { flex: 1; background: #131a2a; color: #aab; border: 1px solid #222c40; border-radius: 8px; padding: 10px; font-size: 14px; }
  .tabs button.on { background: #1a2334; color: #e8b923; border-color: #e8b923; }
  main { padding: 12px 14px 40px; }
  label { font-size: 12px; color: #8894a8; display: block; margin: 10px 0 4px; }
  input, textarea, select { width: 100%; background: #131a2a; color: #e8eaf0; border: 1px solid #222c40; border-radius: 8px; padding: 10px; font-size: 15px; }
  button.go { width: 100%; margin-top: 14px; background: #e8b923; color: #0b0f1a; font-weight: 600; border: 0; border-radius: 8px; padding: 12px; font-size: 15px; }
  button.go:disabled { opacity: .5; }
  .card { background: #101725; border: 1px solid #1c2333; border-radius: 10px; padding: 12px; margin-top: 10px; }
  .card h3 { margin: 0 0 6px; font-size: 15px; color: #f5e9c8; }
  .muted { color: #8894a8; font-size: 12px; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; line-height: 1.5; margin: 0; }
  .hidden { display: none; }
  .err { color: #ff7a7a; font-size: 13px; margin-top: 10px; }
</style>
</head>
<body>
<header><b>NIHILPOINTZERO</b> · mobile · <span class="muted">your PC does the work</span></header>
<div class="tabs">
  <button id="t-ideas" class="on" onclick="tab('ideas')">Ideas</button>
  <button id="t-writer" onclick="tab('writer')">Writer</button>
  <button id="t-advisor" onclick="tab('advisor')">Advisor</button>
</div>
<main>
  <section id="s-ideas">
    <label>Focus area</label>
    <input id="i-focus" placeholder="e.g. Pakistan economy & personal finance" />
    <label>Audience (optional)</label>
    <input id="i-aud" placeholder="e.g. new investors in Karachi" />
    <label>How many</label>
    <input id="i-count" type="number" value="5" min="1" max="10" />
    <button class="go" id="i-go" onclick="genIdeas()">Generate Ideas</button>
    <div id="i-out"></div>
  </section>

  <section id="s-writer" class="hidden">
    <label>Topic</label>
    <textarea id="w-topic" rows="2" placeholder="e.g. Why the rupee keeps devaluing"></textarea>
    <label>Length</label>
    <select id="w-len">
      <option value="short">Short (6-8 min)</option>
      <option value="long" selected>Long (12-17 min)</option>
      <option value="deep-dive">Deep dive (20-28 min)</option>
      <option value="feature-90">Feature (~90 min)</option>
    </select>
    <label>Language</label>
    <select id="w-lang">
      <option value="balanced">Balanced Roman Urdu + English</option>
      <option value="mostly-english">Mostly English</option>
      <option value="mostly-roman-urdu">Mostly Roman Urdu</option>
      <option value="formal-urdu">Formal Urdu</option>
    </select>
    <button class="go" id="w-go" onclick="genScript()">Write Script</button>
    <div id="w-out"></div>
  </section>

  <section id="s-advisor" class="hidden">
    <div id="a-log"></div>
    <label>Ask the advisor</label>
    <textarea id="a-in" rows="2" placeholder="e.g. Is this topic too saturated? Give me a sharper angle."></textarea>
    <button class="go" id="a-go" onclick="ask()">Send</button>
  </section>
</main>
<script>
  var T = new URLSearchParams(location.search).get('t') || '';
  function q(u){ return u + (u.indexOf('?')<0?'?':'&') + 't=' + encodeURIComponent(T); }
  function tab(n){
    ['ideas','writer','advisor'].forEach(function(x){
      document.getElementById('s-'+x).classList.toggle('hidden', x!==n);
      document.getElementById('t-'+x).classList.toggle('on', x===n);
    });
  }
  function esc(s){ return (s||'').replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  async function post(path, body){
    var r = await fetch(q(path), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if(!r.ok) throw new Error((await r.json().catch(function(){return{}})).error || ('HTTP '+r.status));
    return r.json();
  }
  async function genIdeas(){
    var btn=document.getElementById('i-go'), out=document.getElementById('i-out');
    btn.disabled=true; btn.textContent='Working on your PC…'; out.innerHTML='';
    try {
      var ideas = await post('/api/ideas', { focusArea: val('i-focus'), audienceNote: val('i-aud'), count: Number(val('i-count'))||5 });
      out.innerHTML = ideas.map(function(i){
        return '<div class="card"><h3>'+esc(i.title)+'</h3><div class="muted">Score '+i.viewPotentialScore+'/10 · '+esc(i.competitionLevel)+' competition</div><pre>'+esc(i.hook)+'</pre></div>';
      }).join('');
    } catch(e){ out.innerHTML='<div class="err">'+esc(e.message)+'</div>'; }
    btn.disabled=false; btn.textContent='Generate Ideas';
  }
  async function genScript(){
    var btn=document.getElementById('w-go'), out=document.getElementById('w-out');
    btn.disabled=true; btn.textContent='Writing on your PC…'; out.innerHTML='<div class="muted">This can take a while for long scripts…</div>';
    try {
      var s = await post('/api/script', { topic: val('w-topic'), length: val('w-len'), languageMix: val('w-lang') });
      out.innerHTML = '<div class="card"><h3>'+esc(s.title)+'</h3><div class="muted">'+s.estimatedWordCount+' words · ~'+s.estimatedDurationMinutes+' min · saved to Library on your PC</div><pre>'+esc(s.body)+'</pre></div>';
    } catch(e){ out.innerHTML='<div class="err">'+esc(e.message)+'</div>'; }
    btn.disabled=false; btn.textContent='Write Script';
  }
  var convo = [];
  async function ask(){
    var btn=document.getElementById('a-go'), log=document.getElementById('a-log'), inp=document.getElementById('a-in');
    var text = inp.value.trim(); if(!text) return;
    inp.value=''; btn.disabled=true;
    convo.push({role:'user', content:text});
    log.innerHTML += '<div class="card"><div class="muted">You</div><pre>'+esc(text)+'</pre></div>';
    var bubble = document.createElement('div'); bubble.className='card';
    bubble.innerHTML = '<div class="muted">Advisor</div><pre></pre>'; log.appendChild(bubble);
    var pre = bubble.querySelector('pre'); var acc='';
    try {
      var r = await fetch(q('/api/advisor'), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ messages: convo }) });
      var reader = r.body.getReader(); var dec = new TextDecoder();
      while(true){ var x = await reader.read(); if(x.done) break; acc += dec.decode(x.value, {stream:true}); pre.textContent = acc; window.scrollTo(0, document.body.scrollHeight); }
      convo.push({role:'assistant', content:acc});
    } catch(e){ pre.textContent = 'Error: ' + e.message; }
    btn.disabled=false;
  }
  function val(id){ return document.getElementById(id).value.trim(); }
</script>
</body>
</html>`
