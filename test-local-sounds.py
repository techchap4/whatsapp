#!/usr/bin/env python3
"""Browser integration tests: python test-local-sounds.py (requires playwright and Chromium).
Uses a local stub for Supabase/settings and generated dummy WAVs; never uses real user data.
"""
import io, math, os, struct, threading, wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
app = (ROOT / 'app.js').read_text()
extras = (ROOT / 'extras.js').read_text()
sound_code = app[app.index('let ac = null;'):app.index('/* ---------------- auth screen')]
settings_code = extras[extras.index('let settingsView = '):]
assert "const playSend = () => { if (soundOn()) tone(620, 0, 0.1, 0.1); };" in sound_code
harness = '''<!doctype html><html><body><div id="pane-settings"></div><script src="/original-tones.js"></script><script src="/local-sounds.js"></script><script>
const $ = id => document.getElementById(id);
let me = {id:'test',email:'test@example.invalid'}, profiles = {test:{username:'test'}}, myBlocks=new Set(), messages=[];
let stats=[]; class FakeAC { constructor(){this.state='running';this.currentTime=0;this.destination={};} resume(){} createOscillator(){let f={value:0,setValueAtTime(v){this.value=v},exponentialRampToValueAtTime(v){this.end=v}}; return {frequency:f,connect(){},start(){stats.push(f.value)},stop(){}}} createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}} }; window.AudioContext=FakeAC;
const s={notif:{messages:true,desktop:false,ringtone:true,vibrate:false,updates:true},privacy:{},chats:{}};
let switchTab=()=>{}; const S=()=>s, saveSettings=async fn=>{fn(s);return true}, THEMES=[], avatar=()=>'', esc=x=>x, nameOf=p=>p.username, vb=()=>'', verifCard=()=>'', openVerify=()=>{}, toast=()=>{}, registerPush=()=>{};
window.played=[]; const originalPlay=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){window.played.push(this.src); return originalPlay.call(this)};
''' + sound_code + settings_code + '''
settingsView='notif'; renderSettings();
</script></body></html>'''
real_harness = harness.replace(harness[harness.index('let stats=[]; class FakeAC'):harness.index('const s={notif:')], 'let stats=[];\n')
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def do_GET(self):
        if self.path in ('/harness', '/realharness'):
            data=(harness if self.path == '/harness' else real_harness).encode(); self.send_response(200); self.send_header('Content-Type','text/html'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
        else: super().do_GET()
    def log_message(self, *args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'

def wav_bytes():
    b=io.BytesIO()
    with wave.open(b,'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(4000*math.sin(2*math.pi*440*i/8000))) for i in range(800)))
    return b.getvalue()

try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
    context=browser.new_context()
    page=context.new_page(); errors=[]; requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append((r.method, r.url)))
    page.goto(url+'/harness'); active=page.locator('#local-sound-active'); status=page.locator('#local-sound-status')
    expect(active).to_have_value('default')
    assert page.locator('#local-sound-active option').count()==21
    expect(page.locator('#local-sound-active option[value=Bottle]')).to_be_enabled()
    assert 'not Xiaomi' in page.locator('#pane-settings').inner_text()
    page.evaluate('playReceive(); playSend()'); assert page.evaluate('stats') == [880,1175,620]
    # Render actual oscillator graphs in OfflineAudioContext; assert nonzero and different
    # PCM samples for all 19, without relying on fake oscillators or copyrighted audio.
    rendered=page.evaluate("""async () => {
      const out={};
      for (const n of RadaOriginalTones.names) {
        const c=new OfflineAudioContext(1, 48000, 48000);
        RadaOriginalTones.play(c,n);
        const data=(await c.startRendering()).getChannelData(0);
        let power=0, hash=2166136261;
        for (const v of data) {power+=v*v; hash=Math.imul(hash ^ Math.round(v*1e6),16777619)}
        out[n]={power,hash:hash>>>0};
      }
      return out;
    }""")
    assert len(rendered)==19 and all(x['power']>0.01 for x in rendered.values()),rendered
    assert len({x['hash'] for x in rendered.values()})==19,rendered
    names=list(rendered)
    # All options selectable and persisted, user-gesture preview schedules intended notes,
    # and each incoming selection schedules the same first frequency as preview.
    for n in names:
      active.select_option(n); page.evaluate('stats=[]')
      page.locator('#local-sound-preview').click(); expect(status).to_have_text('Preview started.')
      preview=page.evaluate('stats.slice()'); assert preview, n
      page.evaluate('stats=[]; playReceive()'); page.wait_for_function('stats.length>0')
      assert page.evaluate('stats')==preview,n
      page.reload(); expect(active).to_have_value(n)
    active.select_option('Bottle'); page.reload(); expect(active).to_have_value('Bottle')
    page.locator('[data-k=sound]').uncheck(); page.evaluate('stats=[]; playReceive(); playSend()'); page.wait_for_timeout(250)
    assert page.evaluate('stats.length===0')
    page.locator('#local-sound-preview').click(); expect(status).to_contain_text('Turn on')
    page.locator('[data-k=sound]').check(); page.wait_for_timeout(300)
    page.evaluate('stats=[]'); active.select_option('none'); page.evaluate('playReceive(); playSend()'); page.wait_for_timeout(250)
    assert page.evaluate('stats')==[620]
    page.locator('#local-sound-preview').click(); expect(status).to_contain_text('silent')
    # Missing synthesizer falls back to the existing receive tone.
    active.select_option('Bottle'); page.evaluate('stats=[]; window.savedOriginal=window.RadaOriginalTones; window.RadaOriginalTones=null; playReceive()')
    page.wait_for_function('stats.length===2'); assert page.evaluate('stats') == [880,1175]
    page.evaluate('window.RadaOriginalTones=window.savedOriginal')
    # Do not play if muted while awaiting audio activation.
    page.evaluate("stats=[]; ac.state='suspended'; ac.resume=()=>new Promise(r=>window.finishResume=r); playReceive(); localStorage.setItem('chat-sound','off'); ac.state='running'; finishResume()")
    page.wait_for_timeout(200); assert page.evaluate('stats.length')==0
    page.evaluate("localStorage.setItem('chat-sound','on'); ac.state='running'")
    assert not errors, errors
    assert all(method == 'GET' and r.startswith(url) for method, r in requests), requests
    print('PASS: 19 unique non-silent PCM renders; previews, incoming playback, persistence, mute, None, unchanged default/send, missing-synth fallback, playback race, and no uploads.')
    context.close()
    # Real AudioContext (not the fake scheduler) with a mobile-sized/touch browser.
    mobile=browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
    mp=mobile.new_page(); mp.goto(url+'/realharness')
    mp.locator('#local-sound-active').select_option('Chirp')
    mp.locator('#local-sound-preview').click()
    expect(mp.locator('#local-sound-status')).to_have_text('Preview started.')
    assert mp.evaluate('ac.state') == 'running'
    print('PASS: real AudioContext preview after a user gesture in mobile-emulated Chromium.')
    mobile.close(); browser.close()
finally:
    server.shutdown()
